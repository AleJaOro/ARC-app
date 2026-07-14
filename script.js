/* =============================================================
   FIREBASE — INICIALIZACIÓN
   Sustituye estos valores por los de tu proyecto
   (Firebase Console > Configuración del proyecto > Tus apps > SDK).
   ============================================================= */
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.13.0/firebase-app.js";
import {
  getFirestore,
  collection,
  addDoc,
  updateDoc,
  deleteDoc,
  doc,
  onSnapshot,
  query,
  orderBy,
  writeBatch,
  serverTimestamp
} from "https://www.gstatic.com/firebasejs/10.13.0/firebase-firestore.js";

const firebaseConfig = {
  apiKey: "TU_API_KEY",
  authDomain: "TU_PROYECTO.firebaseapp.com",
  projectId: "TU_PROYECTO",
  storageBucket: "TU_PROYECTO.appspot.com",
  messagingSenderId: "TU_SENDER_ID",
  appId: "TU_APP_ID"
};

const app = initializeApp(firebaseConfig);
const db = getFirestore(app);

// Todas las tareas viven en una única colección "tasks".
// Cada documento guarda: title, desc, columnId, order, createdAt.
const tasksCollection = collection(db, "tasks");
const tasksQuery = query(tasksCollection, orderBy("order"));

/* =========================================================
   COLUMNAS (fijas, no se guardan en Firestore)
   ========================================================= */
const COLUMNS = [
  { id: "todo", title: "Por hacer" },
  { id: "in-progress", title: "En progreso" },
  { id: "review", title: "En revisión" },
  { id: "done", title: "Hecho" }
];

// Caché local de tareas, siempre reconstruida a partir de onSnapshot.
// Ya NO existe estado propio ni localStorage: Firestore es la única fuente de verdad.
let tasksCache = [];

/* =========================================================
   REFERENCIAS DOM
   ========================================================= */
const board = document.getElementById("board");
const columnTemplate = document.getElementById("column-template");
const cardTemplate = document.getElementById("card-template");
const syncDot = document.getElementById("sync-dot");
const syncLabel = document.getElementById("sync-label");

const modalOverlay = document.getElementById("modal-overlay");
const modalHeading = modalOverlay.querySelector('[data-role="modal-heading"]');
const taskForm = document.getElementById("task-form");
const taskTitleInput = document.getElementById("task-title");
const taskDescInput = document.getElementById("task-desc");
const modalClose = document.getElementById("modal-close");
const modalCancel = document.getElementById("modal-cancel");

let modalContext = { mode: "create", columnId: null, taskId: null };

/* =========================================================
   TIEMPO REAL — onSnapshot
   Esta suscripción se dispara con el estado inicial y con
   CUALQUIER cambio posterior (propio o de otro dispositivo),
   así que un movimiento hecho en la laptop llega solo al móvil.
   ========================================================= */
onSnapshot(
  tasksQuery,
  (snapshot) => {
    tasksCache = snapshot.docs.map((docSnap) => ({ id: docSnap.id, ...docSnap.data() }));
    setSyncStatus("live");
    render();
  },
  (error) => {
    console.error("Error escuchando Firestore:", error);
    setSyncStatus("error");
  }
);

function setSyncStatus(status) {
  syncDot.classList.remove("is-live", "is-error");
  if (status === "live") {
    syncDot.classList.add("is-live");
    syncLabel.textContent = "Sincronizado en tiempo real";
  } else if (status === "error") {
    syncDot.classList.add("is-error");
    syncLabel.textContent = "Error de conexión con Firestore";
  } else {
    syncLabel.textContent = "Conectando con Firestore…";
  }
}

/* =========================================================
   RENDER (a partir de tasksCache, nunca de estado propio)
   ========================================================= */
function render() {
  board.innerHTML = "";

  COLUMNS.forEach((column) => {
    const columnTasks = tasksCache
      .filter((t) => t.columnId === column.id)
      .sort((a, b) => (a.order ?? 0) - (b.order ?? 0));

    const columnEl = columnTemplate.content.firstElementChild.cloneNode(true);
    columnEl.dataset.columnId = column.id;
    columnEl.querySelector('[data-role="column-title"]').textContent = column.title;
    columnEl.querySelector('[data-role="column-count"]').textContent = columnTasks.length;

    const listEl = columnEl.querySelector('[data-role="task-list"]');
    listEl.classList.toggle("is-empty", columnTasks.length === 0);

    columnTasks.forEach((task) => {
      const cardEl = cardTemplate.content.firstElementChild.cloneNode(true);
      cardEl.dataset.taskId = task.id;
      cardEl.querySelector('[data-role="card-title"]').textContent = task.title;
      cardEl.querySelector('[data-role="card-desc"]').textContent = task.desc || "";
      listEl.appendChild(cardEl);
    });

    board.appendChild(columnEl);
  });
}

/* =========================================================
   CRUD ASÍNCRONO CONTRA FIRESTORE
   ========================================================= */

// CREATE
async function addTask(columnId, title, desc) {
  const columnTasks = tasksCache.filter((t) => t.columnId === columnId);
  const maxOrder = columnTasks.reduce((max, t) => Math.max(max, t.order ?? 0), 0);

  try {
    await addDoc(tasksCollection, {
      title,
      desc,
      columnId,
      order: maxOrder + 1000,
      createdAt: serverTimestamp()
    });
    // No hace falta llamar a render(): onSnapshot recibirá el cambio y
    // volverá a pintar el tablero automáticamente (en este y otros dispositivos).
  } catch (err) {
    console.error("No se pudo crear la tarea:", err);
    alert("No se pudo guardar la tarea. Revisa la consola y tu conexión.");
  }
}

// UPDATE (edición de texto)
async function updateTask(taskId, title, desc) {
  try {
    await updateDoc(doc(db, "tasks", taskId), { title, desc });
  } catch (err) {
    console.error("No se pudo actualizar la tarea:", err);
    alert("No se pudo guardar los cambios. Revisa la consola y tu conexión.");
  }
}

// DELETE
async function deleteTask(taskId) {
  try {
    await deleteDoc(doc(db, "tasks", taskId));
  } catch (err) {
    console.error("No se pudo eliminar la tarea:", err);
    alert("No se pudo eliminar la tarea. Revisa la consola y tu conexión.");
  }
}

// UPDATE (mover entre columnas / reordenar dentro de la misma)
// Recalcula el campo "order" de toda la columna destino en un único
// batch atómico, para que el orden quede consistente para todos los clientes.
async function moveTask(taskId, targetColumnId, targetIndex) {
  const others = tasksCache
    .filter((t) => t.columnId === targetColumnId && t.id !== taskId)
    .sort((a, b) => (a.order ?? 0) - (b.order ?? 0));

  others.splice(targetIndex, 0, { id: taskId, __moved: true });

  try {
    const batch = writeBatch(db);
    others.forEach((t, index) => {
      const ref = doc(db, "tasks", t.id);
      const newOrder = (index + 1) * 1000;
      if (t.__moved) {
        batch.update(ref, { columnId: targetColumnId, order: newOrder });
      } else {
        batch.update(ref, { order: newOrder });
      }
    });
    await batch.commit();
  } catch (err) {
    console.error("No se pudo mover la tarea:", err);
    // Si el batch falla, onSnapshot restaurará el estado real de Firestore
    // en el próximo render, así que la UI no queda inconsistente.
  }
}

/* =========================================================
   HELPERS
   ========================================================= */
function findTask(taskId) {
  return tasksCache.find((t) => t.id === taskId) || null;
}

/* =========================================================
   MODAL
   ========================================================= */
function openModalForCreate(columnId) {
  modalContext = { mode: "create", columnId, taskId: null };
  modalHeading.textContent = "Nueva tarea";
  taskTitleInput.value = "";
  taskDescInput.value = "";
  showModal();
}

function openModalForEdit(taskId) {
  const task = findTask(taskId);
  if (!task) return;
  modalContext = { mode: "edit", columnId: task.columnId, taskId };
  modalHeading.textContent = "Editar tarea";
  taskTitleInput.value = task.title;
  taskDescInput.value = task.desc || "";
  showModal();
}

function showModal() {
  modalOverlay.classList.add("open");
  window.setTimeout(() => taskTitleInput.focus(), 50);
}

function hideModal() {
  modalOverlay.classList.remove("open");
  taskForm.reset();
}

taskForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  const title = taskTitleInput.value.trim();
  const desc = taskDescInput.value.trim();
  if (!title) return;

  const saveBtn = document.getElementById("modal-save");
  saveBtn.disabled = true;

  if (modalContext.mode === "create") {
    await addTask(modalContext.columnId, title, desc);
  } else if (modalContext.mode === "edit") {
    await updateTask(modalContext.taskId, title, desc);
  }

  saveBtn.disabled = false;
  hideModal();
});

modalClose.addEventListener("click", hideModal);
modalCancel.addEventListener("click", hideModal);
modalOverlay.addEventListener("click", (event) => {
  if (event.target === modalOverlay) hideModal();
});
document.addEventListener("keydown", (event) => {
  if (event.key === "Escape" && modalOverlay.classList.contains("open")) hideModal();
});

/* =========================================================
   EVENT DELEGATION — clicks dentro del tablero
   ========================================================= */
board.addEventListener("click", (event) => {
  const addBtn = event.target.closest('[data-action="add-task"]');
  if (addBtn) {
    const columnEl = addBtn.closest(".column");
    openModalForCreate(columnEl.dataset.columnId);
    return;
  }

  const deleteBtn = event.target.closest('[data-action="delete-task"]');
  if (deleteBtn) {
    const cardEl = deleteBtn.closest(".card");
    deleteTask(cardEl.dataset.taskId);
    return;
  }

  const editArea = event.target.closest('[data-action="edit-task"]');
  if (editArea) {
    const cardEl = editArea.closest(".card");
    openModalForEdit(cardEl.dataset.taskId);
    return;
  }
});

/* =========================================================
   DRAG & DROP (API nativa) — delegado en el tablero
   ========================================================= */
let draggedTaskId = null;

board.addEventListener("dragstart", (event) => {
  const cardEl = event.target.closest(".card");
  if (!cardEl) return;
  draggedTaskId = cardEl.dataset.taskId;
  cardEl.classList.add("is-dragging");
  event.dataTransfer.effectAllowed = "move";
  event.dataTransfer.setData("text/plain", draggedTaskId);
});

board.addEventListener("dragend", (event) => {
  const cardEl = event.target.closest(".card");
  if (cardEl) cardEl.classList.remove("is-dragging");
  board.querySelectorAll(".column__list.dragover").forEach((el) => el.classList.remove("dragover"));
  draggedTaskId = null;
});

board.addEventListener("dragover", (event) => {
  const listEl = event.target.closest('[data-role="task-list"]');
  if (!listEl) return;
  event.preventDefault();
  event.dataTransfer.dropEffect = "move";
  listEl.classList.add("dragover");
});

board.addEventListener("dragleave", (event) => {
  const listEl = event.target.closest('[data-role="task-list"]');
  if (!listEl) return;
  if (!listEl.contains(event.relatedTarget)) {
    listEl.classList.remove("dragover");
  }
});

board.addEventListener("drop", (event) => {
  const listEl = event.target.closest('[data-role="task-list"]');
  if (!listEl) return;
  event.preventDefault();
  listEl.classList.remove("dragover");

  const taskId = event.dataTransfer.getData("text/plain") || draggedTaskId;
  if (!taskId) return;

  const columnEl = listEl.closest(".column");
  const targetColumnId = columnEl.dataset.columnId;

  const cards = Array.from(listEl.querySelectorAll(".card:not(.is-dragging)"));
  let targetIndex = cards.length;
  for (let i = 0; i < cards.length; i++) {
    const rect = cards[i].getBoundingClientRect();
    const midpoint = rect.top + rect.height / 2;
    if (event.clientY < midpoint) {
      targetIndex = i;
      break;
    }
  }

  // Operación async: no bloquea la UI; onSnapshot repintará al confirmarse.
  moveTask(taskId, targetColumnId, targetIndex);
});

/* No hay render() inicial aquí: el primer pintado llega solo
   cuando onSnapshot entrega el snapshot inicial de Firestore. */

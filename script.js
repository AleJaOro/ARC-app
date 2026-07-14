(() => {
  "use strict";

  /* =========================================================
     CONFIG & ESTADO
     ========================================================= */
  const STORAGE_KEY = "kanban-board-state-v1";

  const DEFAULT_STATE = {
    columns: [
      {
        id: "todo",
        title: "Por hacer",
        tasks: [
          { id: cryptoId(), title: "Definir alcance del proyecto", desc: "Reunir requisitos con el equipo." },
          { id: cryptoId(), title: "Bocetar la interfaz", desc: "" }
        ]
      },
      {
        id: "in-progress",
        title: "En progreso",
        tasks: [
          { id: cryptoId(), title: "Maquetar el tablero", desc: "Flexbox + variables CSS." }
        ]
      },
      {
        id: "review",
        title: "En revisión",
        tasks: []
      },
      {
        id: "done",
        title: "Hecho",
        tasks: []
      }
    ]
  };

  function cryptoId() {
    return (crypto.randomUUID && crypto.randomUUID()) || `id-${Date.now()}-${Math.random().toString(16).slice(2)}`;
  }

  let state = loadState();

  /* =========================================================
     PERSISTENCIA
     ========================================================= */
  function loadState() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return structuredClone(DEFAULT_STATE);
      const parsed = JSON.parse(raw);
      if (!parsed || !Array.isArray(parsed.columns)) return structuredClone(DEFAULT_STATE);
      return parsed;
    } catch (err) {
      console.error("No se pudo leer el estado guardado, se usa el estado por defecto.", err);
      return structuredClone(DEFAULT_STATE);
    }
  }

  function saveState() {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    } catch (err) {
      console.error("No se pudo guardar el estado en localStorage.", err);
    }
  }

  /* =========================================================
     REFERENCIAS DOM
     ========================================================= */
  const board = document.getElementById("board");
  const columnTemplate = document.getElementById("column-template");
  const cardTemplate = document.getElementById("card-template");

  const modalOverlay = document.getElementById("modal-overlay");
  const modalHeading = modalOverlay.querySelector('[data-role="modal-heading"]');
  const taskForm = document.getElementById("task-form");
  const taskTitleInput = document.getElementById("task-title");
  const taskDescInput = document.getElementById("task-desc");
  const modalClose = document.getElementById("modal-close");
  const modalCancel = document.getElementById("modal-cancel");

  // Contexto del modal: en qué columna se crea, o qué tarea se edita.
  let modalContext = { mode: "create", columnId: null, taskId: null };

  /* =========================================================
     RENDER
     ========================================================= */
  function render() {
    board.innerHTML = "";

    state.columns.forEach((column) => {
      const columnEl = columnTemplate.content.firstElementChild.cloneNode(true);
      columnEl.dataset.columnId = column.id;
      columnEl.querySelector('[data-role="column-title"]').textContent = column.title;
      columnEl.querySelector('[data-role="column-count"]').textContent = column.tasks.length;

      const listEl = columnEl.querySelector('[data-role="task-list"]');
      listEl.classList.toggle("is-empty", column.tasks.length === 0);

      column.tasks.forEach((task) => {
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
     HELPERS DE ESTADO
     ========================================================= */
  function findColumn(columnId) {
    return state.columns.find((c) => c.id === columnId);
  }

  function findTaskLocation(taskId) {
    for (const column of state.columns) {
      const index = column.tasks.findIndex((t) => t.id === taskId);
      if (index !== -1) return { column, index };
    }
    return null;
  }

  function addTask(columnId, title, desc) {
    const column = findColumn(columnId);
    if (!column) return;
    column.tasks.push({ id: cryptoId(), title, desc });
    saveState();
    render();
  }

  function updateTask(taskId, title, desc) {
    const location = findTaskLocation(taskId);
    if (!location) return;
    location.column.tasks[location.index].title = title;
    location.column.tasks[location.index].desc = desc;
    saveState();
    render();
  }

  function deleteTask(taskId) {
    const location = findTaskLocation(taskId);
    if (!location) return;
    location.column.tasks.splice(location.index, 1);
    saveState();
    render();
  }

  function moveTask(taskId, targetColumnId, targetIndex) {
    const source = findTaskLocation(taskId);
    const targetColumn = findColumn(targetColumnId);
    if (!source || !targetColumn) return;

    const [task] = source.column.tasks.splice(source.index, 1);

    // Si se mueve dentro de la misma columna, el índice destino puede
    // haberse desplazado tras quitar la tarjeta de origen.
    let insertAt = targetIndex;
    if (source.column === targetColumn && source.index < targetIndex) {
      insertAt -= 1;
    }
    if (insertAt < 0) insertAt = 0;
    if (insertAt > targetColumn.tasks.length) insertAt = targetColumn.tasks.length;

    targetColumn.tasks.splice(insertAt, 0, task);
    saveState();
    render();
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
    const location = findTaskLocation(taskId);
    if (!location) return;
    const task = location.column.tasks[location.index];
    modalContext = { mode: "edit", columnId: location.column.id, taskId };
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

  taskForm.addEventListener("submit", (event) => {
    event.preventDefault();
    const title = taskTitleInput.value.trim();
    const desc = taskDescInput.value.trim();
    if (!title) return;

    if (modalContext.mode === "create") {
      addTask(modalContext.columnId, title, desc);
    } else if (modalContext.mode === "edit") {
      updateTask(modalContext.taskId, title, desc);
    }
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
    // Sólo quitar la clase si realmente salimos de la lista (no de un hijo).
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

    // Calcular índice de inserción según la posición vertical del cursor
    // respecto a las tarjetas ya presentes en la lista destino.
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

    moveTask(taskId, targetColumnId, targetIndex);
  });

  /* =========================================================
     INICIO
     ========================================================= */
  render();
})();

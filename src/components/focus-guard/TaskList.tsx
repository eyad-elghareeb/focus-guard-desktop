'use client';

import { useFocusGuardStore } from '@/lib/store';
import { useState } from 'react';

export function TaskList() {
  const todos = useFocusGuardStore(s => s.todos);
  const addTodo = useFocusGuardStore(s => s.addTodo);
  const toggleTodo = useFocusGuardStore(s => s.toggleTodo);
  const deleteTodo = useFocusGuardStore(s => s.deleteTodo);
  const clearDoneTodos = useFocusGuardStore(s => s.clearDoneTodos);
  const [newTask, setNewTask] = useState('');

  const doneCount = todos.filter(t => t.done).length;
  const totalCount = todos.length;

  const handleAdd = () => {
    if (!newTask.trim()) return;
    addTodo(newTask.trim());
    setNewTask('');
  };

  return (
    <div className="fg-glass p-5 flex flex-col" style={{ minHeight: 400 }}>
      {/* Header */}
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-2">
          <h3 style={{ fontSize: 14, fontWeight: 700, color: 'var(--text-primary)' }}>Tasks</h3>
          <span className="fg-pill" style={{ background: 'var(--blue-soft)', color: 'var(--blue)', fontSize: 11 }}>
            {doneCount}/{totalCount}
          </span>
        </div>
        {doneCount > 0 && (
          <button
            className="fg-btn fg-btn-ghost"
            style={{ padding: '4px 10px', fontSize: 12 }}
            onClick={clearDoneTodos}
          >
            Clear done
          </button>
        )}
      </div>

      {/* Add Task */}
      <div className="flex gap-2 mb-4">
        <input
          className="fg-input"
          placeholder="Add a task..."
          value={newTask}
          onChange={e => setNewTask(e.target.value)}
          onKeyDown={e => e.key === 'Enter' && handleAdd()}
        />
        <button className="fg-btn fg-btn-primary" onClick={handleAdd} style={{ whiteSpace: 'nowrap' }}>
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
            <line x1="12" y1="5" x2="12" y2="19"/>
            <line x1="5" y1="12" x2="19" y2="12"/>
          </svg>
          Add
        </button>
      </div>

      {/* Task List */}
      <div className="flex-1 overflow-y-auto fg-scrollbar space-y-1" style={{ maxHeight: 400 }}>
        {todos.length === 0 && (
          <div className="flex items-center justify-center py-12" style={{ color: 'var(--text-faint)' }}>
            <p style={{ fontSize: 13 }}>No tasks yet. Add one above.</p>
          </div>
        )}
        {todos.map(todo => (
          <div
            key={todo.id}
            className="flex items-center gap-3 p-3 rounded-xl group"
            style={{
              background: todo.done ? 'rgba(16, 185, 129, 0.05)' : 'transparent',
              transition: 'background 0.2s var(--ease)',
            }}
          >
            {/* Checkbox */}
            <button
              onClick={() => toggleTodo(todo.id)}
              className="flex-shrink-0 flex items-center justify-center rounded-md border"
              style={{
                width: 20, height: 20,
                background: todo.done ? 'var(--green)' : 'transparent',
                borderColor: todo.done ? 'var(--green)' : 'var(--text-faint)',
                transition: 'all 0.2s var(--ease)',
              }}
            >
              {todo.done && (
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="3" strokeLinecap="round">
                  <polyline points="20 6 9 17 4 12"/>
                </svg>
              )}
            </button>

            {/* Text */}
            <span
              className="flex-1"
              style={{
                fontSize: 14,
                color: todo.done ? 'var(--text-muted)' : 'var(--text-primary)',
                textDecoration: todo.done ? 'line-through' : 'none',
                transition: 'all 0.2s var(--ease)',
              }}
            >
              {todo.text}
            </span>

            {/* Delete */}
            <button
              onClick={() => deleteTodo(todo.id)}
              className="flex-shrink-0 opacity-0 group-hover:opacity-100 transition-opacity"
              style={{ color: 'var(--text-faint)', fontSize: 16 }}
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                <line x1="18" y1="6" x2="6" y2="18"/>
                <line x1="6" y1="6" x2="18" y2="18"/>
              </svg>
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}

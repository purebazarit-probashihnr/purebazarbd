'use client';

import { useState } from 'react';
import Button from '@/components/ui/button';
import Modal from '@/components/ui/modal';
import { T } from '@/i18n/language-provider';

export default function HoldSaleModal({ onConfirm, onCancel }) {
  const [note, setNote] = useState('');

  function submit(event) {
    event.preventDefault();
    onConfirm(note.trim());
  }

  return (
    <Modal open onClose={onCancel} title="Hold Sale">
      <form onSubmit={submit} className="w-full max-w-md space-y-4 rounded-xl bg-white p-5 shadow-xl">
        <label className="block text-sm font-medium text-slate-700">
          Customer Name / Token Number (Optional)
          <input
            autoFocus
            type="text"
            value={note}
            maxLength={100}
            onChange={(event) => setNote(event.target.value)}
            className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
          />
        </label>
        <div className="flex justify-end gap-2">
          <Button type="button" variant="secondary" onClick={onCancel}>Cancel</Button>
          <Button type="submit">Confirm Hold</Button>
        </div>
      </form>
    </Modal>
  );
}

'use client';

import { Check } from './Icons';

interface Props {
  id: string;
  name: string;
  active: boolean;
  onToggle: (id: string) => void;
}

export default function SupplierChip({ id, name, active, onToggle }: Props) {
  return (
    <button
      type="button"
      className={`chip${active ? ' on' : ''}`}
      onClick={() => onToggle(id)}
    >
      {active && <Check size={15} />}
      <span>{name}</span>
    </button>
  );
}

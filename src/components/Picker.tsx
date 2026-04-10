import type { ReactNode } from 'react';

type PickerValue = string | number;

export type PickerOption<T extends PickerValue> = {
  key: string;
  value: T;
  left: string;
  right?: ReactNode;
  disabled?: boolean;
};

type PickerProps<T extends PickerValue> = {
  ariaLabel: string;
  open: boolean;
  valueLeft: string;
  valueRight?: ReactNode;
  onToggle: () => void;
  onSelect: (value: T) => void;
  options: PickerOption<T>[];
  selectedValue: T;
  className?: string;
};

export function Picker<T extends PickerValue>({
  ariaLabel,
  open,
  valueLeft,
  valueRight,
  onToggle,
  onSelect,
  options,
  selectedValue,
  className
}: PickerProps<T>) {
  return (
    <div className={`picker${className ? ` ${className}` : ''}`}>
      <button
        type="button"
        className="picker-trigger"
        aria-haspopup="listbox"
        aria-expanded={open}
        onClick={onToggle}
      >
        <span className="picker-value-left">{valueLeft}</span>
        {valueRight !== undefined ? (
          <span className="picker-value-right">
            <span>{valueRight}</span>
            <span className="picker-caret">{open ? '▴' : '▾'}</span>
          </span>
        ) : (
          <span className="picker-caret">{open ? '▴' : '▾'}</span>
        )}
      </button>

      {open ? (
        <div className="picker-menu" role="listbox" aria-label={ariaLabel}>
          {options.map((option) => (
            <button
              key={option.key}
              type="button"
              role="option"
              aria-selected={selectedValue === option.value}
              className="picker-option"
              disabled={option.disabled}
              onClick={() => onSelect(option.value)}
            >
              <span className="picker-value-left">{option.left}</span>
              {option.right !== undefined ? <span className="picker-value-right">{option.right}</span> : null}
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}

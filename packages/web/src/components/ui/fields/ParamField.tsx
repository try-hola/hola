import React from 'react';
import type { AppEnvVar, ValidationIssue } from '@hola/shared';
import { FieldShell } from './FieldShell';
import { TextInput } from './TextInput';
import { NumberInput } from './NumberInput';
import { BooleanToggle } from './BooleanToggle';
import { RadioGroup } from './RadioGroup';
import { SelectInput } from './SelectInput';
import { TimezoneSelect } from './TimezoneSelect';
import { SecretInput } from './SecretInput';

export type ParamFieldProps = {
  spec: AppEnvVar;
  value: string;
  onChange(value: string): void;
  /** This field's issues, already filtered by the caller (path === `env.${spec.key}`). */
  issues?: ValidationIssue[];
  showSecret?: boolean;
  onToggleSecret?: () => void;
  /** Wired by the caller to `generateSecretValue(spec.generate)` (or the
   * legacy random-hex fallback for specless secrets). Omit to hide the wand. */
  onGenerateSecret?: () => void;
};

const RADIO_OPTION_LIMIT = 4;

/**
 * Dispatches a manifest-declared `AppEnvVar` spec to the right leaf input,
 * wrapped in `FieldShell`. `isSecret` always wins the dispatch — a secret is
 * a secret visually regardless of its declared `type` (e.g. a generated hex
 * token is still masked-with-reveal, not rendered as a bare text field).
 */
export const ParamField: React.FC<ParamFieldProps> = ({
  spec,
  value,
  onChange,
  issues,
  showSecret,
  onToggleSecret,
  onGenerateSecret,
}) => {
  const label = spec.label ?? spec.key;
  // Tri-state mirrors `validateParamValue`'s `effectivelyRequired` exactly, so
  // the UI's required marker never disagrees with what the server will reject.
  const required = spec.required ?? spec.isSecret;
  const error = issues?.find((i) => i.severity === 'error')?.message;
  const hasError = Boolean(error);
  const id = `param-${spec.key}`;

  let field: React.ReactNode;
  if (spec.isSecret) {
    field = (
      <SecretInput
        id={id}
        value={value}
        onChange={onChange}
        visible={showSecret}
        onToggleVisibility={onToggleSecret}
        onGenerate={onGenerateSecret}
        placeholder={spec.placeholder}
        hasError={hasError}
      />
    );
  } else {
    const type = spec.type ?? 'string';
    switch (type) {
      case 'boolean':
        field = <BooleanToggle id={id} value={value} onChange={onChange} trueValue={spec.trueValue} falseValue={spec.falseValue} />;
        break;
      case 'enum': {
        const options = spec.options ?? [];
        field = options.length > 0 && options.length <= RADIO_OPTION_LIMIT
          ? <RadioGroup name={id} value={value} onChange={onChange} options={options} />
          : <SelectInput id={id} value={value} onChange={onChange} options={options} hasError={hasError} />;
        break;
      }
      case 'integer':
      case 'port': {
        // Mirror `validateParamValue`'s port clamping: min/max may only
        // narrow the implied 1-65535 range, never widen it.
        const min = type === 'port' ? Math.max(1, spec.min ?? 1) : spec.min;
        const max = type === 'port' ? Math.min(65535, spec.max ?? 65535) : spec.max;
        field = <NumberInput id={id} value={value} onChange={onChange} min={min} max={max} placeholder={spec.placeholder} hasError={hasError} />;
        break;
      }
      case 'timezone':
        field = <TimezoneSelect id={id} value={value} onChange={onChange} placeholder={spec.placeholder} hasError={hasError} />;
        break;
      case 'url':
      case 'email':
      case 'string':
      default:
        field = (
          <TextInput
            id={id}
            type={type === 'url' || type === 'email' ? type : 'text'}
            value={value}
            onChange={onChange}
            placeholder={spec.placeholder}
            pattern={spec.pattern}
            hasError={hasError}
          />
        );
        break;
    }
  }

  return (
    <FieldShell label={label} required={required} description={spec.description} error={error} htmlFor={id}>
      {field}
    </FieldShell>
  );
};

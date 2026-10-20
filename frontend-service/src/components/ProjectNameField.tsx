import { useId } from "react";
import { PROJECT_NAME_HINT } from "../validation";

type Props = {
  value: string;
  error?: string;
  onChange: (value: string) => void;
  onBlur: () => void;
};

export default function ProjectNameField({ value, error, onChange, onBlur }: Props) {
  const hintId = useId();

  return (
    <>
      <input
        className="border p-2 rounded w-full placeholder:text-white aria-invalid:border-red-500"
        placeholder="Project name"
        aria-label="Project name"
        aria-invalid={error ? true : undefined}
        aria-describedby={hintId}
        name="name"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onBlur={onBlur}
      />
      <p
        id={hintId}
        className={`text-sm mt-1 mb-2 ${error ? "text-red-400" : "text-gray-400"}`}
      >
        {error ?? PROJECT_NAME_HINT}
      </p>
    </>
  );
}

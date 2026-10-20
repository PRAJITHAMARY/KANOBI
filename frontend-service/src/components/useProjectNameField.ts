import { useState } from "react";
import { projectNameError } from "../validation";

/** State for a project name input that validates on blur and on submit. */
export function useProjectNameField(initial = "") {
  const [value, setValue] = useState(initial);
  const [error, setError] = useState<string>();

  const validate = () => {
    const problem = projectNameError(value);
    setError(problem);
    return !problem;
  };

  return {
    value,
    error,
    onChange: (next: string) => {
      setValue(next);
      // Once an error is showing, clear it as soon as the name is fixed.
      if (error) setError(projectNameError(next));
    },
    onBlur: validate,
    validate,
    reset: (next = initial) => {
      setValue(next);
      setError(undefined);
    },
  };
}

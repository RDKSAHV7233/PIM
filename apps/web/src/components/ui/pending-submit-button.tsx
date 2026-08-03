"use client";

import type { ComponentProps, Ref } from "react";
import { useFormStatus } from "react-dom";
import { Button } from "@/components/ui/button";

type PendingSubmitButtonProps = Omit<ComponentProps<typeof Button>, "children"> & {
  idleLabel: string;
  pendingLabel?: string;
  ref?: Ref<HTMLButtonElement>;
};

export function PendingSubmitButton({
  idleLabel,
  pendingLabel,
  disabled,
  ...props
}: PendingSubmitButtonProps) {
  const { pending } = useFormStatus();

  return (
    <Button
      {...props}
      disabled={disabled || pending}
      aria-busy={pending}
      aria-live="polite"
    >
      {pending ? pendingLabel ?? `${idleLabel}...` : idleLabel}
    </Button>
  );
}

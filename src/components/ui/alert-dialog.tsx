"use client"

import * as React from "react"
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogFooter,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog"
import { cn } from "@/lib/utils"
import { buttonVariants } from "@/components/ui/button"

function AlertDialog({
  open,
  onOpenChange,
  children,
}: {
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  children: React.ReactNode;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      {children}
    </Dialog>
  );
}

function AlertDialogContent({
  className,
  children,
}: {
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <DialogContent showCloseButton={false} className={cn("sm:max-w-md", className)}>
      {children}
    </DialogContent>
  );
}

function AlertDialogHeader({ className, ...props }: React.ComponentProps<"div">) {
  return <DialogHeader className={className} {...props} />;
}

function AlertDialogFooter({ className, ...props }: React.ComponentProps<"div">) {
  return <DialogFooter className={className} {...props} />;
}

function AlertDialogTitle({ className, ...props }: React.ComponentProps<"h2">) {
  return <DialogTitle className={className} {...props} />;
}

function AlertDialogDescription({ className, ...props }: React.ComponentProps<"p">) {
  return <DialogDescription className={className} {...props} />;
}

function AlertDialogAction({
  className,
  onClick,
  children,
  ...props
}: React.ComponentProps<"button">) {
  return (
    <button
      className={cn(buttonVariants(), className)}
      onClick={onClick}
      {...props}
    >
      {children}
    </button>
  );
}

function AlertDialogCancel({
  className,
  onClick,
  children,
  ...props
}: React.ComponentProps<"button">) {
  return (
    <button
      className={cn(buttonVariants({ variant: "outline" }), className)}
      onClick={onClick}
      {...props}
    >
      {children}
    </button>
  );
}

export {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
}

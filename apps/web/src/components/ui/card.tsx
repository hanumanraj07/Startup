import * as React from 'react';
import { cva, type VariantProps } from 'class-variance-authority';
import { cn } from '@/lib/utils';

const cardVariants = cva('rounded-card', {
  variants: {
    intent: {
      // Byte-identical to the pre-variant className, so every unconverted
      // call site (the vast majority — calm-tier surfaces stay on this by
      // design) renders exactly as before.
      default: 'border border-line bg-paper-0 shadow-card',
      // Vibrant-tier chrome only — see globals.css's glass-panel comment.
      // Never used on a money/evidence surface.
      glass: 'glass-panel shadow-float',
      gradient: 'border border-transparent bg-hero-gradient shadow-elevated',
    },
  },
  defaultVariants: { intent: 'default' },
});

export interface CardProps extends React.HTMLAttributes<HTMLDivElement>, VariantProps<typeof cardVariants> {}

export function Card({ className, intent, ...props }: CardProps) {
  return <div className={cn(cardVariants({ intent }), className)} {...props} />;
}

export function CardHeader({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return <div className={cn('flex flex-col gap-1 p-6 pb-0', className)} {...props} />;
}

export function CardTitle({ className, ...props }: React.HTMLAttributes<HTMLHeadingElement>) {
  return <h3 className={cn('text-[19px] font-semibold text-ink-900', className)} {...props} />;
}

export function CardDescription({ className, ...props }: React.HTMLAttributes<HTMLParagraphElement>) {
  return <p className={cn('text-sm text-ink-500', className)} {...props} />;
}

export function CardContent({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return <div className={cn('p-6', className)} {...props} />;
}

export function CardFooter({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return <div className={cn('flex items-center gap-3 p-6 pt-0', className)} {...props} />;
}

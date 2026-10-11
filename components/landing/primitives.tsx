import Image from 'next/image';
import * as motion from 'motion/react-client';
import type { ReactNode } from 'react';

/** Curva de desaceleração usada em todas as entradas. */
export const EASE = [0.22, 1, 0.36, 1] as const;

export function Logo({ size = 28, className }: { size?: number; className?: string }) {
  // logo.png tem proporção ~0,85 (largura/altura)
  return <Image src="/logo.png" alt="" width={size} height={Math.round(size * 1.18)} className={className} priority />;
}

/** Surge ao entrar na tela: sobe, desfoca e ganha opacidade. */
export function Reveal({
  children,
  delay = 0,
  className,
}: {
  children: ReactNode;
  delay?: number;
  className?: string;
}) {
  return (
    <motion.div
      className={className}
      initial={{ opacity: 0, y: 20, filter: 'blur(8px)' }}
      whileInView={{ opacity: 1, y: 0, filter: 'blur(0px)' }}
      viewport={{ once: true, margin: '-80px' }}
      transition={{ duration: 0.8, delay, ease: EASE }}
    >
      {children}
    </motion.div>
  );
}

/** Rótulo pequeno com ponto verde, acima dos títulos de seção. */
export function Eyebrow({ children }: { children: ReactNode }) {
  return (
    <p className="inline-flex items-center gap-2 text-[11px] font-medium uppercase tracking-[0.18em] text-muted">
      <span className="size-1.5 rounded-full bg-lime shadow-[0_0_12px_var(--color-lime)]" />
      {children}
    </p>
  );
}

/** Destaque em serifada itálica, no verde da marca. */
export function Accent({ children }: { children: ReactNode }) {
  // whitespace-nowrap: o destaque não quebra no meio ("em" sozinho numa linha)
  return <em className="whitespace-nowrap font-display font-normal italic text-lime">{children}</em>;
}

export function SectionHeader({
  eyebrow,
  title,
  subtitle,
}: {
  eyebrow: string;
  title: ReactNode;
  subtitle?: string;
}) {
  return (
    <Reveal className="mx-auto mb-14 flex max-w-2xl flex-col items-center gap-4 text-center">
      <Eyebrow>{eyebrow}</Eyebrow>
      <h2 className="text-balance text-4xl font-medium tracking-tight sm:text-5xl">{title}</h2>
      {subtitle && <p className="text-pretty text-base text-muted sm:text-lg">{subtitle}</p>}
    </Reveal>
  );
}

/** Card com borda sutil e brilho verde no hover. */
export function Card({ children, className = '' }: { children: ReactNode; className?: string }) {
  return (
    <div
      className={`group relative overflow-hidden rounded-2xl border border-line bg-surface/80 p-6 transition-colors duration-300 hover:border-line-strong ${className}`}
    >
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(60%_60%_at_50%_0%,rgb(228_255_58/0.07),transparent_70%)] opacity-0 transition-opacity duration-500 group-hover:opacity-100" />
      <div className="relative">{children}</div>
    </div>
  );
}

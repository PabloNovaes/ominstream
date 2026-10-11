"use client";

import { requestInstallUrl, type InstallState } from "@/app/actions/install";
import { AnimatePresence, motion } from "motion/react";
import {
  createContext,
  useActionState,
  useCallback,
  useContext,
  useEffect,
  useId,
  useRef,
  useState,
  type ReactNode,
} from "react";

/**
 * Modal de instalação: pede a chave de acesso, valida no servidor e mostra a URL do addon.
 * Qualquer <InstallTrigger> da página abre o mesmo modal.
 */

const InstallContext = createContext<() => void>(() => {});

export function InstallProvider({ children }: { children: ReactNode }) {
  const [open, setOpen] = useState(false);
  // Remonta o modal a cada abertura: estado limpo (sem erro ou URL da vez anterior)
  const [session, setSession] = useState(0);
  const openDialog = useCallback(() => {
    setSession((s) => s + 1);
    setOpen(true);
  }, []);

  return (
    <InstallContext.Provider value={openDialog}>
      {children}
      <AnimatePresence>
        {open && <InstallDialog key={session} onClose={() => setOpen(false)} />}
      </AnimatePresence>
    </InstallContext.Provider>
  );
}

export function InstallTrigger({
  children,
  className,
}: {
  children: ReactNode;
  className?: string;
}) {
  const open = useContext(InstallContext);
  return (
    <motion.button
      type="button"
      onClick={open}
      className={className}
      whileTap={{ scale: 0.97 }}>
      {children}
    </motion.button>
  );
}

const EASE = [0.22, 1, 0.36, 1] as const;

function InstallDialog({ onClose }: { onClose: () => void }) {
  const [state, action, pending] = useActionState<InstallState, FormData>(
    requestInstallUrl,
    { status: "idle" },
  );
  const [reveal, setReveal] = useState(false);
  // Campo controlado: o React 19 limpa campos não controlados após cada envio do formulário,
  // o que obrigaria a colar a chave de novo depois de um erro
  const [key, setKey] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);
  const titleId = useId();
  const errorId = useId();

  // Esc fecha; foco no campo ao abrir
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    inputRef.current?.focus();
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <motion.div
      className="fixed inset-0 z-[100] grid place-items-center p-4"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.2 }}>
      <button
        type="button"
        aria-label="Fechar"
        onClick={onClose}
        className="absolute inset-0 bg-ink/70 backdrop-blur-sm"
      />

      <motion.div
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        className="relative w-full max-w-md overflow-hidden rounded-3xl border border-line-strong bg-surface p-6 shadow-[0_30px_80px_-20px_rgb(0_0_0/0.8)] sm:p-8"
        initial={{ opacity: 0, y: 24, scale: 0.96 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        exit={{ opacity: 0, y: 12, scale: 0.98 }}
        transition={{ duration: 0.35, ease: EASE }}>
        <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(60%_50%_at_50%_0%,rgb(228_255_58/0.10),transparent_70%)]" />

        <button
          type="button"
          onClick={onClose}
          aria-label="Fechar"
          className="absolute right-4 top-4 grid size-8 place-items-center rounded-full text-muted transition-colors hover:bg-white/[0.06] hover:text-fg">
          ✕
        </button>

        <div className="relative">
          <AnimatePresence mode="wait" initial={false}>
            {state.status === "ok" ? (
              <InstallSuccess
                key="ok"
                titleId={titleId}
                manifestUrl={state.manifestUrl}
                stremioUrl={state.stremioUrl}
              />
            ) : (
              <motion.form
                key="form"
                action={action}
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0, x: -16 }}
                transition={{ duration: 0.25 }}>
                <span className="grid size-11 place-items-center rounded-2xl border border-line-strong bg-ink text-lg">
                  🔑
                </span>
                <h2
                  id={titleId}
                  className="mt-5 text-2xl font-medium tracking-tight">
                  Chave de acesso
                </h2>
                <p className="mt-2 text-sm text-muted">
                  Informe a chave do OminStream para gerar a sua URL de
                  instalação.
                </p>

                <motion.div
                  key={state.status === "error" ? state.attempt : 0}
                  className="mt-6"
                  animate={
                    state.status === "error" ? { x: [0, -8, 8, -5, 5, 0] } : {}
                  }
                  transition={{ duration: 0.4 }}>
                  <label htmlFor="install-key" className="sr-only">
                    Chave de acesso
                  </label>
                  <div
                    className={`flex items-center rounded-xl border bg-ink transition-colors focus-within:border-lime/60 ${
                      state.status === "error"
                        ? "border-red-400/60"
                        : "border-line-strong"
                    }`}>
                    <input
                      ref={inputRef}
                      id="install-key"
                      name="key"
                      value={key}
                      onChange={(e) => setKey(e.target.value)}
                      type={reveal ? "text" : "password"}
                      autoComplete="off"
                      spellCheck={false}
                      required
                      placeholder="Cole a sua chave aqui"
                      aria-invalid={state.status === "error"}
                      aria-describedby={
                        state.status === "error" ? errorId : undefined
                      }
                      className="min-w-0 flex-1 bg-transparent px-4 py-3 font-mono text-sm text-fg outline-none placeholder:font-sans placeholder:text-muted/70"
                    />
                    <button
                      type="button"
                      onClick={() => setReveal((r) => !r)}
                      className="px-4 text-xs font-medium text-muted transition-colors hover:text-fg"
                      aria-label={reveal ? "Ocultar chave" : "Mostrar chave"}>
                      {reveal ? "Ocultar" : "Mostrar"}
                    </button>
                  </div>
                </motion.div>

                <AnimatePresence>
                  {state.status === "error" && (
                    <motion.p
                      id={errorId}
                      role="alert"
                      initial={{ opacity: 0, height: 0 }}
                      animate={{ opacity: 1, height: "auto" }}
                      exit={{ opacity: 0, height: 0 }}
                      className="mt-3 text-sm text-red-300">
                      {state.message}
                    </motion.p>
                  )}
                </AnimatePresence>

                <button
                  type="submit"
                  disabled={pending}
                  className="mt-6 inline-flex w-full items-center justify-center gap-2 rounded-full bg-lime px-6 py-3 text-sm font-semibold text-ink transition-opacity disabled:opacity-60">
                  {pending ? (
                    <>
                      <div className="transition-all animate-spin size-4 rounded-full border-2 border-ink/30 border-t-ink" />
                      Verificando...
                    </>
                  ) : (
                    "Gerar URL de instalação"
                  )}
                </button>
              </motion.form>
            )}
          </AnimatePresence>
        </div>
      </motion.div>
    </motion.div>
  );
}

function InstallSuccess({
  titleId,
  manifestUrl,
  stremioUrl,
}: {
  titleId: string;
  manifestUrl: string;
  stremioUrl: string;
}) {
  const [copied, setCopied] = useState(false);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(manifestUrl);
    } catch {
      // Fora de HTTPS (ex.: IP da rede local) a API de área de transferência não existe
      const area = document.createElement("textarea");
      area.value = manifestUrl;
      document.body.appendChild(area);
      area.select();
      document.execCommand("copy");
      area.remove();
    }
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <motion.div
      initial={{ opacity: 0, x: 16 }}
      animate={{ opacity: 1, x: 0 }}
      transition={{ duration: 0.35, ease: EASE }}>
      <motion.span
        className="grid size-11 place-items-center rounded-2xl bg-lime text-lg font-bold text-ink"
        initial={{ scale: 0.6, rotate: -20 }}
        animate={{ scale: 1, rotate: 0 }}
        transition={{ type: "spring", stiffness: 300, damping: 15 }}>
        ✓
      </motion.span>
      <h2 id={titleId} className="mt-5 text-2xl font-medium tracking-tight">
        Chave confirmada
      </h2>
      <p className="mt-2 text-sm text-muted">
        Esta é a sua URL de instalação. Ela inclui a chave: não compartilhe.
      </p>

      <div className="mt-6 rounded-xl border border-lime/30 bg-ink p-3">
        <code className="block break-all font-mono text-xs leading-relaxed text-lime">
          {manifestUrl}
        </code>
      </div>

      <div className="mt-4 grid gap-2 sm:grid-cols-2">
        <button
          type="button"
          onClick={copy}
          className="rounded-full bg-lime px-5 py-3 text-sm font-semibold text-ink transition-transform active:scale-[0.98]">
          {copied ? "Copiada ✓" : "Copiar URL"}
        </button>
        <a
          href={stremioUrl}
          className="rounded-full border border-line-strong px-5 py-3 text-center text-sm font-medium transition-colors hover:bg-white/[0.04]">
          Abrir no Stremio
        </a>
      </div>

      <p className="mt-5 text-xs leading-relaxed text-muted">
        <span className="text-fg">No Nuvio:</span> Configurações → Addons →
        colar a URL.
      </p>
    </motion.div>
  );
}

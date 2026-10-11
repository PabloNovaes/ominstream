import {
  FUNNEL,
  NAV,
  QUALITY,
  SIGNALS,
  SOURCES,
  STATS,
  STEPS,
  TRACKS,
} from "@/components/landing/content";
import {
  Accent,
  Card,
  EASE,
  Eyebrow,
  Logo,
  Reveal,
  SectionHeader,
} from "@/components/landing/primitives";
import { MotionProvider } from "@/components/motion-provider";
import * as motion from "motion/react-client";

/** Entrada do hero ao carregar a página (acima da dobra, então não espera o scroll). */
const enter = (delay: number) => ({
  initial: { opacity: 0, y: 24, filter: "blur(10px)" },
  animate: { opacity: 1, y: 0, filter: "blur(0px)" },
  transition: { duration: 0.9, delay, ease: EASE },
});

export default function Home() {
  return (
    <MotionProvider>
      <div className="relative min-h-screen overflow-x-clip">
        <Nav />
        <main>
          <Hero />
          <Stats />
          <HowItWorks />
          <Features />
          <SourcesMarquee />
          <Install />
        </main>
        <Footer />
      </div>
    </MotionProvider>
  );
}

function Nav() {
  return (
    <motion.header
      initial={{ opacity: 0, y: -12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.6, ease: EASE }}
      className="fixed inset-x-0 top-0 z-50 border-b border-line bg-ink/70 backdrop-blur-xl">
      <div className="mx-auto flex h-14 max-w-6xl items-center justify-between px-4 sm:px-6">
        <a
          href="#"
          className="flex items-center gap-2 text-sm font-semibold tracking-tight">
          <Logo size={18} />
          OminStream
        </a>
        <nav className="hidden items-center gap-7 text-sm text-muted md:flex">
          {NAV.map((item) => (
            <a
              key={item.href}
              href={item.href}
              className="transition-colors hover:text-fg">
              {item.label}
            </a>
          ))}
        </nav>
        <a
          href="#instalar"
          className="rounded-full border border-line-strong bg-white/[0.04] px-4 py-1.5 text-sm font-medium transition-colors hover:border-lime/60 hover:text-lime">
          Instalar
        </a>
      </div>
    </motion.header>
  );
}

function Hero() {
  return (
    <section className="relative flex min-h-[92vh] flex-col items-center justify-center px-4 pt-28 pb-20 text-center">
      {/* Fundo: brilho verde no topo + grade que some nas bordas */}
      <div className="pointer-events-none absolute inset-0 -z-10 bg-[radial-gradient(55%_45%_at_50%_0%,rgb(228_255_58/0.16),transparent_70%)]" />
      <div className="pointer-events-none absolute inset-0 -z-10 bg-[linear-gradient(to_right,rgb(255_255_255/0.035)_1px,transparent_1px),linear-gradient(to_bottom,rgb(255_255_255/0.035)_1px,transparent_1px)] bg-[size:56px_56px] [mask-image:radial-gradient(70%_60%_at_50%_30%,black,transparent)]" />

      <motion.div {...enter(0)} className="relative mb-8">
        <motion.div
          aria-hidden
          className="absolute inset-0 rounded-3xl bg-lime blur-2xl"
          animate={{ opacity: [0.18, 0.35, 0.18], scale: [0.9, 1.05, 0.9] }}
          transition={{ duration: 4, repeat: Infinity, ease: "easeInOut" }}
        />
        <Logo size={70} />
      </motion.div>

      <motion.div {...enter(0.1)}>
        <Eyebrow>Addon para Nuvio &amp; Stremio</Eyebrow>
      </motion.div>

      <motion.h1
        {...enter(0.2)}
        className="mt-6 max-w-4xl text-balance max-sm:text-4xl text-5xl font-light leading-[1.05] tracking-tight sm:text-6xl md:text-7xl">
        <span className="bg-linear-to-b from-white to-white/50 bg-clip-text text-transparent">
          Streams dublados.
        </span>
        <br />
        <span className="bg-linear-to-b from-white to-white/50 bg-clip-text text-transparent">
          Verificados
        </span>{" "}
        <Accent>em PT-BR.</Accent>
      </motion.h1>

      <motion.p
        {...enter(0.3)}
        className="mt-6 max-w-xl text-pretty text-base text-muted sm:text-lg">
        Junta suas fontes de stream, lê as faixas de áudio direto no arquivo e
        mostra só os links com dublagem brasileira, em 4K e Full HD.
      </motion.p>

      <motion.div
        {...enter(0.4)}
        className="mt-9 flex flex-col items-center gap-3 sm:flex-row">
        <motion.a
          href="#instalar"
          whileHover={{ scale: 1.03 }}
          whileTap={{ scale: 0.98 }}
          className="inline-flex items-center gap-2 rounded-full bg-lime px-6 py-3 text-sm font-semibold text-ink shadow-[0_0_40px_-8px_var(--color-lime)]">
          Instalar no Nuvio <span aria-hidden>↗</span>
        </motion.a>
        <a
          href="#como-funciona"
          className="rounded-full border border-line-strong px-6 py-3 text-sm font-medium text-fg transition-colors hover:bg-white/[0.04]">
          Como funciona
        </a>
      </motion.div>

      <motion.ul
        {...enter(0.5)}
        className="mt-10 flex items-center gap-6 text-xs uppercase tracking-[0.2em] text-muted/70">
        {["Nuvio", "Stremio", "TorBox"].map((item) => (
          <li key={item}>{item}</li>
        ))}
      </motion.ul>

      {/* Indicador de rolagem */}
      <motion.div
        aria-hidden
        className="absolute bottom-8 hidden h-10 w-6 rounded-full border border-line-strong sm:block"
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ delay: 1.2 }}>
        <motion.span
          className="absolute left-1/2 top-2 size-1.5 -translate-x-1/2 rounded-full bg-lime"
          animate={{ y: [0, 14, 0], opacity: [1, 0.2, 1] }}
          transition={{ duration: 2, repeat: Infinity, ease: "easeInOut" }}
        />
      </motion.div>
    </section>
  );
}

function Stats() {
  return (
    <section className="mx-auto max-w-6xl px-4 sm:px-6">
      {/* gap-px sobre fundo da cor da borda = linhas divisórias em qualquer quantidade de colunas */}
      <Reveal className="grid grid-cols-2 max-sm:grid-rows-2 gap-px overflow-hidden rounded-2xl bg-line  border border-line md:grid-cols-4">
        {STATS.map((stat) => (
          <div
            key={stat.label}
            className="flex flex-col gap-1 bg-zinc-950 px-6 py-7 items-center justify-center">
            <strong className="text-2xl sm:text-3xl font-medium tracking-tight">
              {stat.value}
            </strong>
            <span className="text-xs sm:text-sm text-muted">{stat.label}</span>
          </div>
        ))}
      </Reveal>
    </section>
  );
}

function HowItWorks() {
  return (
    <section
      id="como-funciona"
      className="mx-auto max-w-6xl scroll-mt-20 px-4 py-28 sm:px-6">
      <SectionHeader
        eyebrow="Como funciona"
        title={
          <>
            Do clique ao play, <Accent>sem pegadinha</Accent>
          </>
        }
        subtitle="Quatro etapas a cada título que você abre, em poucos segundos."
      />
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {STEPS.map((step, i) => (
          <Reveal key={step.n} delay={i * 0.08}>
            <Card className="h-full">
              <span className="font-mono text-xs text-lime">{step.n}</span>
              <h3 className="mt-6 text-lg font-medium">{step.title}</h3>
              <p className="mt-2 text-sm leading-relaxed text-muted">
                {step.text}
              </p>
            </Card>
          </Reveal>
        ))}
      </div>
    </section>
  );
}

function Features() {
  return (
    <section
      id="recursos"
      className="mx-auto max-w-6xl scroll-mt-20 px-4 pb-28 sm:px-6">
      <SectionHeader
        eyebrow="Recursos"
        title={
          <>
            Lê o arquivo, <Accent>não o nome</Accent>
          </>
        }
        subtitle={
          '"Dub" nem sempre é dublado em português. O OminStream confia na etiqueta de idioma de cada faixa.'
        }
      />

      <div className="grid gap-4 md:grid-cols-3">
        {/* Faixas reais: a pegadinha do "Dub" russo */}
        <Reveal className="md:col-span-2">
          <Card className="h-full">
            <h3 className="text-lg font-medium">Faixas lidas de verdade</h3>
            <p className="mt-1 text-sm text-muted">
              Só o cabeçalho do arquivo: nada de baixar o filme inteiro.
            </p>
            <ul className="mt-6 flex flex-col gap-2">
              {TRACKS.map((track, i) => (
                <motion.li
                  key={track.name}
                  initial={{ opacity: 0, x: -16 }}
                  whileInView={{ opacity: 1, x: 0 }}
                  viewport={{ once: true }}
                  transition={{
                    duration: 0.5,
                    delay: 0.2 + i * 0.12,
                    ease: EASE,
                  }}
                  className={`flex items-center gap-3 rounded-xl border px-4 py-3 text-sm ${
                    track.ok
                      ? "border-lime/30 bg-lime/[0.06]"
                      : "border-line bg-white/[0.02] text-muted"
                  }`}>
                  <span
                    className={`grid size-6 shrink-0 place-items-center rounded-full text-xs font-bold ${
                      track.ok
                        ? "bg-lime text-ink"
                        : "bg-white/[0.06] text-muted"
                    }`}>
                    {track.ok ? "✓" : "✕"}
                  </span>
                  <code
                    className={`w-14 shrink-0 font-mono text-xs ${track.ok ? "text-lime" : ""}`}>
                    {track.lang}
                  </code>
                  <span
                    className={`flex-1 truncate ${track.ok ? "text-fg" : "line-through decoration-white/20"}`}>
                    {track.name}
                  </span>
                  <span className="hidden text-xs text-muted sm:inline">
                    {track.codec}
                  </span>
                </motion.li>
              ))}
            </ul>
            <p className="mt-5 text-xs text-muted">
              <span className="text-fg">256 KB</span> lidos de um arquivo de 26
              GB · <span className="text-fg">54 ms</span>
            </p>
          </Card>
        </Reveal>

        <Reveal delay={0.1}>
          <Card className="h-full">
            <h3 className="text-lg font-medium">Indícios que não enganam</h3>
            <p className="mt-1 text-sm text-muted">
              Para listar rápido, sem abrir o arquivo.
            </p>
            <ul className="mt-6 flex flex-wrap gap-2">
              {SIGNALS.map((signal) => (
                <li
                  key={signal.text}
                  className={`rounded-full border px-3 py-1 text-xs font-medium ${
                    signal.ok
                      ? "border-lime/30 bg-lime/10 text-lime"
                      : "border-line text-muted line-through"
                  }`}>
                  {signal.text}
                </li>
              ))}
            </ul>
          </Card>
        </Reveal>

        <Reveal delay={0.1}>
          <Card className="h-full">
            <h3 className="text-lg font-medium">4K e Full HD lado a lado</h3>
            <p className="mt-1 text-sm text-muted">
              Vagas por resolução: o 1080p não some quando existe 4K.
            </p>
            <ul className="mt-6 flex flex-wrap gap-2">
              {QUALITY.map((q, i) => (
                <li
                  key={q}
                  className={`rounded-lg border px-3 py-1.5 font-mono text-xs ${
                    i < 3
                      ? "border-lime/30 text-lime"
                      : "border-line text-fg/80"
                  }`}>
                  {q}
                </li>
              ))}
            </ul>
          </Card>
        </Reveal>

        <Reveal delay={0.15} className="md:col-span-2">
          <Card className="h-full">
            <h3 className="text-lg font-medium">Só o que toca na hora</h3>
            <p className="mt-1 max-w-lg text-sm text-muted">
              Torrents conferidos no cache do TorBox antes de aparecerem na
              lista. Nada de &quot;baixando…&quot; no meio da sessão.
            </p>
            <div className="mt-6 grid grid-cols-3 gap-3">
              {FUNNEL.map((step, i) => (
                <motion.div
                  key={step.label}
                  initial={{ opacity: 0, y: 12 }}
                  whileInView={{ opacity: 1, y: 0 }}
                  viewport={{ once: true }}
                  transition={{
                    duration: 0.5,
                    delay: 0.25 + i * 0.15,
                    ease: EASE,
                  }}
                  className={`rounded-xl border p-4 ${
                    step.highlight
                      ? "border-lime/40 bg-lime/[0.08]"
                      : "border-line bg-white/[0.02]"
                  }`}>
                  <strong
                    className={`block text-2xl font-medium sm:text-3xl ${step.highlight ? "text-lime" : ""}`}>
                    {step.value}
                  </strong>
                  <span className="text-xs text-muted">{step.label}</span>
                </motion.div>
              ))}
            </div>
          </Card>
        </Reveal>
      </div>
    </section>
  );
}

function SourcesMarquee() {
  return (
    <section id="fontes" className="scroll-mt-20 border-y border-line py-12">
      <p className="mb-8 text-center text-xs uppercase tracking-[0.2em] text-muted">
        Agrega as fontes que você já usa
      </p>
      <div className="relative overflow-hidden [mask-image:linear-gradient(to_right,transparent,black_15%,black_85%,transparent)]">
        <motion.div
          className="flex w-max gap-14 pr-14"
          animate={{ x: ["0%", "-50%"] }}
          transition={{ duration: 32, repeat: Infinity, ease: "linear" }}>
          {[...SOURCES, ...SOURCES].map((source, i) => (
            <span
              key={`${source}-${i}`}
              aria-hidden={i >= SOURCES.length}
              className="whitespace-nowrap text-xl font-medium tracking-tight text-fg/40 transition-colors hover:text-lime">
              {source}
            </span>
          ))}
        </motion.div>
      </div>
    </section>
  );
}

function Install() {
  const steps = [
    {
      title: "Copie a URL de instalação",
      text: "Ela inclui o seu segredo, então não compartilhe.",
      code: "https://seu-endereco/‹segredo›/manifest.json",
    },
    {
      title: "Adicione no Nuvio",
      text: "Configurações → Addons → cole a URL.",
    },
    {
      title: "Abra um título",
      text: "Os streams dublados aparecem no topo, por resolução.",
    },
  ];
  return (
    <section
      id="instalar"
      className="mx-auto max-w-6xl scroll-mt-20 px-4 py-28 sm:px-6">
      <Reveal>
        <div className="relative overflow-hidden rounded-3xl border border-line bg-surface px-6 py-16 sm:px-12">
          <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(50%_70%_at_50%_100%,rgb(228_255_58/0.12),transparent_70%)]" />
          <div className="relative">
            <SectionHeader
              eyebrow="Instalar"
              title={
                <>
                  Pronto em <Accent>um minuto</Accent>
                </>
              }
            />
            <ol className="mx-auto grid max-w-4xl gap-4 md:grid-cols-3">
              {steps.map((step, i) => (
                <Reveal key={step.title} delay={i * 0.1}>
                  <li className="flex h-full flex-col gap-3 rounded-2xl border border-line bg-ink/60 p-5">
                    <span className="grid size-8 place-items-center rounded-full bg-lime text-sm font-semibold text-ink">
                      {i + 1}
                    </span>
                    <h3 className="font-medium">{step.title}</h3>
                    <p className="text-sm text-muted">{step.text}</p>
                    {step.code && (
                      <code className="mt-auto break-all rounded-lg border border-line bg-surface-2 px-3 py-2 font-mono text-[11px] text-lime">
                        {step.code}
                      </code>
                    )}
                  </li>
                </Reveal>
              ))}
            </ol>
          </div>
        </div>
      </Reveal>
    </section>
  );
}

function Footer() {
  return (
    <footer className="mx-auto flex max-w-6xl flex-col items-center justify-between gap-3 border-t border-line px-4 py-8 text-sm text-muted sm:flex-row sm:px-6">
      <span className="flex items-center gap-2 font-medium text-fg">
        <Logo size={16} />
        OminStream
      </span>
      <p className="text-xs">
        Uso pessoal · agrega fontes de terceiros, não hospeda conteúdo.
      </p>
    </footer>
  );
}

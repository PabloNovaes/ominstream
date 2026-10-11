import { z } from 'zod';

/**
 * Configuração via variáveis de ambiente, validada uma vez na primeira leitura.
 * Localmente vem do .env.local; na Vercel, das Environment Variables do projeto.
 */

const bool = z.enum(['true', 'false']).transform(v => v === 'true');
const int = (def: number) => z.coerce.number().int().positive().default(def);
// Variável opcional: vazia ("CHAVE=") conta como não definida
const optional = <T extends z.ZodType>(inner: T) => z.preprocess(v => (v === '' ? undefined : v), inner.optional());

const sourceSchema = z.object({
  name: z.string().min(1),
  url: z.string().url().refine(u => u.endsWith('/manifest.json'), 'precisa terminar em /manifest.json'),
  weight: z.number().positive().default(1),
  // false para fontes que exibem bandeiras/idiomas sem critério (ex.: Magneto marca 🇧🇷 em tudo)
  trustLanguageTags: z.boolean().default(true),
});

const schema = z.object({
  ADDON_SECRET: z.string().min(16, 'use um segredo longo (16+ caracteres)'),

  TORBOX_API_KEY: optional(z.string()),

  // Conversão de IDs do TMDB para IMDb (o Nuvio usa "tmdb:" quando o catálogo vem do TMDB)
  TMDB_API_KEY: optional(z.string()),
  META_ADDON_URL: optional(z.string().url()),

  TORBOX_CLEANUP_REJECTED: bool.default(true),

  SOURCES: z
    .string()
    .default('[]')
    .transform((raw, ctx) => {
      try {
        return JSON.parse(raw);
      } catch {
        ctx.addIssue({ code: 'custom', message: 'SOURCES não é um JSON válido' });
        return z.NEVER;
      }
    })
    .pipe(z.array(sourceSchema)),
  SOURCE_TIMEOUT_MS: int(6000),
  RESPONSE_BUDGET_MS: int(9000),

  DEEP_VERIFY_MIN_RESOLUTION: int(2160),
  PROBE_HTTP_BEFORE_LISTING: bool.default(true),
  HEURISTIC_MIN_SCORE: int(50),
  ACCEPT_GENERIC_POR: bool.default(true),
  ACCEPT_PT_PT: bool.default(false),
  BR_RELEASE_GROUPS: z
    .string()
    .default('')
    .transform(s => s.split(',').map(g => g.trim().toLowerCase()).filter(Boolean)),

  PLAY_MAX_ATTEMPTS: int(3),
  // Vagas por resolução na lista ("2160:3,1080:3,720:1"); resoluções fora da lista não aparecem
  RESULTS_PER_RESOLUTION: z
    .string()
    .default('2160:3,1080:3,720:1')
    .transform((raw, ctx) => {
      const quotas = new Map<number, number>();
      for (const part of raw.split(',').map(p => p.trim()).filter(Boolean)) {
        const m = part.match(/^(\d{3,4}):(\d+)$/);
        if (!m) {
          ctx.addIssue({ code: 'custom', message: `RESULTS_PER_RESOLUTION: "${part}" deveria ser "resolução:vagas"` });
          return z.NEVER;
        }
        quotas.set(Number(m[1]), Number(m[2]));
      }
      return quotas;
    }),
});

export type Config = z.infer<typeof schema>;
export type SourceAddon = z.infer<typeof sourceSchema>;

let cached: Config | null = null;

export function getConfig(): Config {
  if (cached) return cached;
  const parsed = schema.safeParse(process.env);
  if (!parsed.success) {
    const issues = parsed.error.issues.map(i => `  - ${i.path.join('.')}: ${i.message}`).join('\n');
    throw new Error(`Configuração inválida:\n${issues}`);
  }
  cached = parsed.data;
  return cached;
}

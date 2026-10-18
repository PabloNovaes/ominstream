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
  // Fonte que prende o link ao IP de quem pediu a lista (padrão: hosts *.elfhosted.com)
  ipBound: z.boolean().optional(),
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

  // Torrents adicionados à conta só para ler o cabeçalho e que não foram para a lista:
  // off = nunca apaga · dry-run = só registra no log o que apagaria · on = apaga
  TORBOX_CLEANUP: z.enum(['off', 'dry-run', 'on']).default('dry-run'),
  // Hashes que a limpeza nunca toca, mesmo que pareçam temporários (separados por vírgula)
  TORBOX_PROTECTED_HASHES: z
    .string()
    .default('')
    .transform(s => new Set(s.split(',').map(h => h.trim().toLowerCase()).filter(Boolean))),

  // Confere as faixas de áudio das versões "dubladas" antes de listá-las (o nome pode mentir)
  VERIFY_AUDIO_ENABLED: bool.default(true),
  // Arquivos lidos no máximo por busca (cada torrent é adicionado à conta do TorBox para a leitura)
  VERIFY_AUDIO_MAX: int(10),
  // Tempo máximo que a conferência pode somar à listagem (depois disso, segue em segundo plano)
  VERIFY_AUDIO_BUDGET_MS: int(5000),

  // "4K + áudio PT-BR": vídeo de um 4K sem dublagem com o áudio de uma versão dublada
  PAIR_ENABLED: bool.default(true),
  // Diferença máxima de duração entre as duas versões (acima disso, cortes ou velocidades diferentes)
  PAIR_MAX_DIFF_MS: int(1000),
  // Sem par exato, aceita o mais próximo até este limite, com aviso (ex.: vinheta de distribuidora
  // de poucos segundos no arquivo dublado; se ela estiver no início, ajusta-se o atraso no player)
  PAIR_APPROX_DIFF_MS: int(5000),
  // Versões dubladas testadas como parceiras do 4K
  PAIR_MAX_ATTEMPTS: int(5),
  // Releases 4K testados como vídeo do par (cada um é adicionado à conta do TorBox para ler a duração)
  PAIR_MAX_VIDEOS: int(3),
  // Tempo máximo que a busca do par pode somar à listagem (depois disso, segue em segundo plano)
  PAIR_BUDGET_MS: int(6000),
  // 4K sem áudio PT-BR mostrados no fim da lista, com o áudio original (0 = só o que toca dublado)
  UNDUBBED_4K_RESULTS: int(0),
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

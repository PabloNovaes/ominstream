import type { Metadata, Viewport } from "next";
import { Geist, Instrument_Serif, Open_Sans } from "next/font/google";
import "./globals.css";

const geistSans = Geist({ variable: "--font-geist-sans", subsets: ["latin"] });
const geistMono = Open_Sans({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});
// Serifada em itálico para os destaques dos títulos ("em PT-BR.")
const instrumentSerif = Instrument_Serif({
  variable: "--font-instrument-serif",
  subsets: ["latin"],
  weight: "400",
  style: ["normal", "italic"],
});

export const metadata: Metadata = {
  title: "OminStream · Streams dublados, verificados",
  description:
    "Addon para Nuvio e Stremio que agrega suas fontes, confirma o áudio em português (PT-BR) direto no arquivo e entrega só os melhores links dublados.",
};

export const viewport: Viewport = {
  themeColor: "#050608",
  colorScheme: "dark",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html
      lang="pt-BR"
      className={`${geistSans.variable} ${geistMono.variable} ${instrumentSerif.variable}`}>
      <body>{children}</body>
    </html>
  );
}

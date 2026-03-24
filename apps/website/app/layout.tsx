import type { Metadata } from "next";
import "./globals.css";
import { OG_IMAGE_PATH, SITE_NAME, SITE_URL } from "./site";

export const metadata: Metadata = {
  metadataBase: new URL(SITE_URL),
  title: "pi-gui — A native desktop for AI coding agents",
  description:
    "pi-gui is a macOS desktop app that wraps the pi coding agent in a Codex-style interface. Multi-workspace sessions, real-time agent execution, and persistent history.",
  alternates: {
    canonical: "/",
  },
  openGraph: {
    title: "pi-gui — A native desktop for AI coding agents",
    description:
      "A Codex-style desktop interface for AI coding agents. Manage workspaces, run sessions, and review agent work from a native macOS app.",
    type: "website",
    url: SITE_URL,
    siteName: SITE_NAME,
    images: [
      {
        url: OG_IMAGE_PATH,
        width: 1200,
        height: 630,
        alt: "pi-gui desktop app preview",
      },
    ],
  },
  twitter: {
    card: "summary_large_image",
    title: "pi-gui — A native desktop for AI coding agents",
    description:
      "A Codex-style desktop interface for AI coding agents. Manage workspaces, run sessions, and review agent work from a native macOS app.",
    images: [OG_IMAGE_PATH],
  },
  icons: {
    icon: [{ url: "/icon.svg", type: "image/svg+xml" }],
    shortcut: "/icon.svg",
  },
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}

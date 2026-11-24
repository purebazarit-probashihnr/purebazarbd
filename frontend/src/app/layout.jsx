import './globals.css';
import './theme.css';
import Script from 'next/script';
import { ThemeProvider, themeInitScript } from '@/components/common/theme-provider';
import StoreProvider from '@/store/provider';
import AppToaster from '@/components/common/toaster';
import { LanguageProvider } from '@/i18n/language-provider';
import AppShell from '@/components/common/app-shell';
import ServiceWorkerRegistration from '@/components/common/service-worker-registration';

export const metadata = {
  title: 'PureBazar',
  description: 'Offline inventory and POS',
};

export const viewport = {
  width: 'device-width',
  initialScale: 1,
};

export default function RootLayout({ children }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeInitScript }} />
        <Script src="/receipt-logo-path.js" strategy="beforeInteractive" />
      </head>
      <body>
        <ThemeProvider>
          <StoreProvider><LanguageProvider>
            <ServiceWorkerRegistration />
            <AppShell>{children}</AppShell>
            <AppToaster />
          </LanguageProvider></StoreProvider>
        </ThemeProvider>
      </body>
    </html>
  );
}
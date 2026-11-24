import "./globals.css";

export const metadata = {
  title: "Arabic Coach: Saudi Arabic for work",
  description: "Speak Saudi Arabic with your customers and staff. 1,000 core words, role-play chats and explanations in Hindi, Urdu or English.",
  appleWebApp: { capable: true, title: "Arabic Coach", statusBarStyle: "black-translucent" },
  icons: { icon: "/icon.svg", apple: "/icon-192.png" },
};

export const viewport = { themeColor: "#0f2a24", width: "device-width", initialScale: 1, viewportFit: "cover" };

export default function RootLayout({ children }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}

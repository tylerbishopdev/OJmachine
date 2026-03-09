import "./globals.css";

export const metadata = {
  title: "OJ Movie Maker",
  description:
    "Put OJ Simpson in any movie. Generate a poster, storyboard, and trailer.",
};

export default function RootLayout({ children }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}

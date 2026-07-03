import './styles.css';

export const metadata = {
  title: '智慧農場觀測上傳',
  description: '智慧農場植株觀測資料上傳系統'
};

export default function RootLayout({ children }) {
  return (
    <html lang="zh-Hant">
      <body>{children}</body>
    </html>
  );
}

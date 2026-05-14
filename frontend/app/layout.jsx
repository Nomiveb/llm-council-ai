import "../src/index.css";
import "../src/App.css";
import "../src/components/Sidebar.css";
import "../src/components/ChatInterface.css";
import "../src/components/CouncilResponse.css";
import "../src/components/HistoryPage.css";
import "../src/components/LogsPage.css";

export const metadata = {
  title: "LLM Council",
  description: "Multi-model council with peer review and final synthesis",
};

export default function RootLayout({ children }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}

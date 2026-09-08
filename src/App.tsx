import { BrowserRouter, Route, Routes } from "react-router-dom";
import { DefaultProviders } from "./components/providers/default.tsx";
import Index from "./pages/Index.tsx";
import EntityPage from "./pages/entity/page.tsx";
import GraphPage from "./pages/graph/page.tsx";
import FamilyTreePage from "./pages/family-tree/page.tsx";
import NotFound from "./pages/NotFound.tsx";

export default function App() {
  return (
    <DefaultProviders>
      <BrowserRouter>
        <Routes>
          <Route path="/" element={<Index />} />
          <Route path="/entity/:id" element={<EntityPage />} />
          <Route path="/graph/:id" element={<GraphPage />} />
          <Route path="/family-tree/:id" element={<FamilyTreePage />} />
          <Route path="*" element={<NotFound />} />
        </Routes>
      </BrowserRouter>
    </DefaultProviders>
  );
}

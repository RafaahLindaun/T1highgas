import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";

import Login from "./pages/Login";
import MapaGPS from "./pages/MapaGPS";
import IA_Command from "./pages/IA";
import CarBase from "./pages/CarBase";
import RoutesHistory from "./pages/Routes";
import Conta from "./pages/Conta";
import Abastecimento from "./pages/Abastecimento";

import BottomMenu from "./components/BottomMenu";
import ProtectedRoute from "./components/ProtectedRoute";
import { AuthProvider, useAuth } from "./context/AuthContext";
import { EcoProvider } from "./context/EcoContext";

function AppRoutes() {
  const { user } = useAuth();

  return (
    <BrowserRouter>
      <Routes>
        <Route path="/" element={!user ? <Login /> : <Navigate to="/mapa" />} />
        
<Route path="/abastecimento" element={<ProtectedRoute><Abastecimento /></ProtectedRoute>} />
        <Route path="/mapa" element={<ProtectedRoute><MapaGPS /></ProtectedRoute>} />
        <Route path="/ia" element={<ProtectedRoute><IA_Command /></ProtectedRoute>} />
        <Route path="/carbase" element={<ProtectedRoute><CarBase /></ProtectedRoute>} />
        <Route path="/routes" element={<ProtectedRoute><RoutesHistory /></ProtectedRoute>} />
        <Route path="/conta" element={<ProtectedRoute><Conta /></ProtectedRoute>} />

        <Route path="*" element={<Navigate to={user ? "/mapa" : "/"} />} />
      </Routes>

      {user ? <BottomMenu /> : null}
    </BrowserRouter>
  );
}

export default function App() {
  return (
    <AuthProvider>
      <EcoProvider>
        <AppRoutes />
      </EcoProvider>
    </AuthProvider>
  );
}

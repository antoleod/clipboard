import { useAuth } from './hooks/useAuth';
import { AuthFlow } from './components/AuthFlow';
import ClipboardApp from './components/ClipboardAppPro';

function App() {
  const { user, loading } = useAuth();

  if (loading) {
    return <div className="boot-shell">Preparing secure workspace...</div>;
  }

  return user ? <ClipboardApp key={user.uid} /> : <AuthFlow />;
}

export default App;



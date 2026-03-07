import { useAuth } from './hooks/useAuth';
import { AuthFlow } from './components/AuthFlow';
import ClipboardApp from './components/ClipboardAppPro';

function App() {
  const { user, loading } = useAuth();

  if (loading) {
    // You can replace this with a proper loading spinner component
    return (
      <div className="layout" style={{ justifyContent: 'center', alignItems: 'center' }}>
        <h1>Loading...</h1>
      </div>
    );
  }

  // Using a key on ClipboardApp ensures it fully remounts when the user changes.
  // This is a robust way to prevent any state from leaking between different user accounts.
  return user ? <ClipboardApp key={user.uid} /> : <AuthFlow />;
}

export default App;


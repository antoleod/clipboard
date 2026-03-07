import { useContext } from 'react';
import { AuthContext } from '../components/authContext';

export const useAuth = () => useContext(AuthContext);

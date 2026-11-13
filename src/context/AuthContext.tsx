import React, { createContext, useContext, useState, useEffect, useCallback } from 'react';
import type { User, UserRole } from '../types';
import { CLINIC_ID } from '../types';
import { ApiError, api } from '../db/api';
import { DEMO_MODE } from '../db';

interface AuthContextType {
  currentUser: User | null;
  needsSetup: boolean;
  isLoading: boolean;
  login: (email: string, password: string) => Promise<void>;
  setup: (input: { name: string; email: string; password: string; businessName: string }) => Promise<void>;
  changePassword: (currentPassword: string, newPassword: string) => Promise<void>;
  logout: () => Promise<void>;
  hasPermission: (requiredRole: UserRole) => boolean;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

const ROLE_RANK: Record<UserRole, number> = {
  owner: 3,
  receptionist: 2,
  doctor: 1,
};

const DEMO_USER: User = {
  id: 'demo-owner',
  orgId: CLINIC_ID,
  email: 'owner@smilecare.demo',
  role: 'owner',
  name: 'Demo Owner',
  branchId: null,
  isActive: true,
};

export const AuthProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [currentUser, setCurrentUser] = useState<User | null>(null);
  const [needsSetup, setNeedsSetup] = useState(false);
  const [isLoading, setIsLoading] = useState(true);

  const refreshSession = useCallback(async () => {
    if (DEMO_MODE) {
      const saved = sessionStorage.getItem('smilecare_demo_user');
      setCurrentUser(saved ? JSON.parse(saved) as User : null);
      setNeedsSetup(false);
      setIsLoading(false);
      return;
    }
    try {
      const status = await api<{ needsSetup: boolean }>('/api/setup/status');
      setNeedsSetup(status.needsSetup);
      if (!status.needsSetup) {
        try {
          const me = await api<{ user: User }>('/api/auth/me');
          setCurrentUser(me.user);
        } catch {
          setCurrentUser(null);
        }
      } else {
        setCurrentUser(null);
      }
    } catch {
      setCurrentUser(null);
      setNeedsSetup(false);
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      void refreshSession();
    }, 0);
    const safety = window.setTimeout(() => setIsLoading(false), 4000);
    return () => {
      window.clearTimeout(timer);
      window.clearTimeout(safety);
    };
  }, [refreshSession]);

  const loginDemo = (email: string, password: string) => {
    if (!email.trim() || password.length < 4) {
      throw new Error('Enter your email and a password of at least 4 characters.');
    }
    const user = { ...DEMO_USER, email: email.trim() };
    sessionStorage.setItem('smilecare_demo_user', JSON.stringify(user));
    setCurrentUser(user);
    setNeedsSetup(false);
  };

  const login = async (email: string, password: string) => {
    if (DEMO_MODE) {
      loginDemo(email, password);
      return;
    }
    try {
      const result = await api<{ user: User }>('/api/auth/login', {
        method: 'POST',
        body: JSON.stringify({ email, password }),
      });
      setCurrentUser(result.user);
      setNeedsSetup(false);
    } catch (error) {
      // Static hosts (Vercel SPA) have no API — fall back to the browser demo session.
      if (typeof window !== 'undefined' && /\.vercel\.app$/i.test(window.location.hostname)) {
        loginDemo(email, password);
        return;
      }
      if (error instanceof ApiError) throw new Error(error.message);
      throw new Error('Unable to sign in. Please try again.');
    }
  };

  const setup = async (input: { name: string; email: string; password: string; businessName: string }) => {
    if (DEMO_MODE) throw new Error('Setup is only available when the clinic API is running.');
    try {
      const result = await api<{ user: User }>('/api/setup', {
        method: 'POST',
        body: JSON.stringify(input),
      });
      setCurrentUser(result.user);
      setNeedsSetup(false);
    } catch (error) {
      if (error instanceof ApiError) throw new Error(error.message);
      throw new Error('Unable to create the owner account.');
    }
  };

  const changePassword = async (currentPassword: string, newPassword: string) => {
    if (DEMO_MODE) {
      if (!currentPassword || newPassword.length < 10) {
        throw new Error('Enter your current password and a new password of at least 10 characters.');
      }
      if (!currentUser) throw new Error('Sign in again, then change the password.');
      const updated = { ...currentUser, mustChangePassword: false };
      sessionStorage.setItem('smilecare_demo_user', JSON.stringify(updated));
      setCurrentUser(updated);
      return;
    }
    const result = await api<{ user: User }>('/api/auth/change-password', {
      method: 'POST',
      body: JSON.stringify({ currentPassword, newPassword }),
    });
    setCurrentUser(result.user);
  };

  const logout = async () => {
    if (!DEMO_MODE) {
      try {
        await api<void>('/api/auth/logout', { method: 'POST' });
      } catch {
        // Clear the local session even if the server is unreachable.
      }
    }
    sessionStorage.removeItem('smilecare_demo_user');
    setCurrentUser(null);
  };

  const hasPermission = (requiredRole: UserRole): boolean => {
    if (!currentUser) return false;
    return ROLE_RANK[currentUser.role] >= ROLE_RANK[requiredRole];
  };

  return (
    <AuthContext.Provider value={{ currentUser, needsSetup, isLoading, login, setup, changePassword, logout, hasPermission }}>
      {children}
    </AuthContext.Provider>
  );
};

export const useAuth = () => {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used inside an AuthProvider');
  return ctx;
};

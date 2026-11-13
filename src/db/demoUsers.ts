import type { User, UserRole } from '../types';
import { CLINIC_ID } from '../types';

const DEMO_USERS_KEY = 'smilecare_demo_users';

const seedUsers = (): User[] => [
  {
    id: 'demo-owner',
    orgId: CLINIC_ID,
    email: 'owner@smilecare.demo',
    role: 'owner',
    name: 'Demo Owner',
    branchId: null,
    isActive: true,
  },
  {
    id: 'demo-reception',
    orgId: CLINIC_ID,
    email: 'reception@smilecare.demo',
    role: 'receptionist',
    name: 'Demo Reception',
    branchId: 'br-main',
    isActive: true,
  },
  {
    id: 'demo-doctor',
    orgId: CLINIC_ID,
    email: 'doctor@smilecare.demo',
    role: 'doctor',
    name: 'Demo Doctor',
    branchId: 'br-main',
    doctorId: 'emp-1',
    isActive: true,
  },
];

const read = (): User[] => {
  try {
    const raw = sessionStorage.getItem(DEMO_USERS_KEY);
    if (!raw) {
      const seeded = seedUsers();
      sessionStorage.setItem(DEMO_USERS_KEY, JSON.stringify(seeded));
      return seeded;
    }
    return JSON.parse(raw) as User[];
  } catch {
    return seedUsers();
  }
};

const write = (users: User[]) => {
  sessionStorage.setItem(DEMO_USERS_KEY, JSON.stringify(users));
};

export const listDemoUsers = async (): Promise<User[]> => read();

export const createDemoUser = async (input: {
  name: string;
  email: string;
  password: string;
  role: UserRole;
}): Promise<User> => {
  const users = read();
  if (users.some((user) => user.email.toLowerCase() === input.email.trim().toLowerCase())) {
    throw new Error('An account with this email already exists.');
  }
  if (input.password.length < 10) {
    throw new Error('Temporary password must be at least 10 characters.');
  }
  const user: User = {
    id: `demo-user-${Math.random().toString(36).slice(2, 9)}`,
    orgId: CLINIC_ID,
    email: input.email.trim(),
    role: input.role,
    name: input.name.trim(),
    branchId: null,
    isActive: true,
    mustChangePassword: true,
  };
  users.push(user);
  write(users);
  return user;
};

export const setDemoUserActive = async (id: string, isActive: boolean): Promise<User> => {
  const users = read();
  const index = users.findIndex((user) => user.id === id);
  if (index < 0) throw new Error('Account not found.');
  users[index] = { ...users[index], isActive };
  write(users);
  return users[index];
};

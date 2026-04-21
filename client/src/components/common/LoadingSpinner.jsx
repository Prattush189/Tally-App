import { Activity } from 'lucide-react';

export default function LoadingSpinner({ message = 'Loading data...' }) {
  return (
    <div className="flex flex-col items-center justify-center py-20">
      <Activity size={40} className="text-indigo-500 animate-pulse" />
      <p className="text-gray-400 mt-4 text-sm">{message}</p>
    </div>
  );
}

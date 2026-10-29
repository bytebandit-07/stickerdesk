import React from 'react';
import { useStudioStore } from '../store/useStudioStore';
import { Library } from './pages/Library';
import { Editor } from './pages/Editor';

export const App: React.FC = () => {
  const activeView = useStudioStore((state) => state.activeView);

  return activeView === 'editor' ? <Editor /> : <Library />;
};

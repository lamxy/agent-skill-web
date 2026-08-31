import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode
} from 'react';

/**
 * 頁腳動作區。頁面把自己的主要動作投遞到全站頁腳，由頁腳統一渲染。
 *
 * 起因是腳本下載頁原本自帶一條 fixed 的動作列；頁腳改為 sticky 後兩條
 * 固定欄疊在一起，頁面底部會出現兩條分隔線。與其讓每個頁面各自處理避讓，
 * 不如讓頁面把動作交給頁腳——畫面上只留一條固定欄。
 */
export type FooterAction = {
  /** 動作左側的說明文字，省略時只顯示按鈕 */
  hint?: ReactNode;
  /** 實際的按鈕或連結 */
  content: ReactNode;
};

type FooterActionStore = {
  action: FooterAction | null;
  setAction: (action: FooterAction | null) => void;
};

const FooterActionContext = createContext<FooterActionStore | undefined>(
  undefined
);

export function FooterActionProvider({
  children,
  initialAction = null
}: {
  children: ReactNode;
  /* 供測試與伺服器端首屏直接給定動作；一般使用由頁面以 hook 投遞 */
  initialAction?: FooterAction | null;
}): ReactNode {
  const [action, setAction] = useState<FooterAction | null>(initialAction);
  const value = useMemo(() => ({ action, setAction }), [action]);
  return (
    <FooterActionContext.Provider value={value}>
      {children}
    </FooterActionContext.Provider>
  );
}

/** 供頁腳讀取目前該顯示哪個動作 */
export function useFooterAction(): FooterAction | null {
  return useContext(FooterActionContext)?.action ?? null;
}

/**
 * 頁面用來投遞動作。離開頁面時自動清空，避免動作殘留到下一頁。
 *
 * content 每次 render 都是新的 element，若直接進相依陣列會無限更新，
 * 因此由呼叫端以 deps 明確指定何時需要重新投遞。
 */
export function useProvideFooterAction(
  build: () => FooterAction,
  deps: unknown[]
): void {
  const store = useContext(FooterActionContext);
  const setAction = store?.setAction;
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const memoBuild = useCallback(build, deps);

  useEffect(() => {
    if (!setAction) return;
    setAction(memoBuild());
    return () => setAction(null);
  }, [setAction, memoBuild]);
}

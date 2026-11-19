import {useState} from 'react';
import {createRoot} from 'react-dom/client';
function App(){
  const [amount, setAmount] = useState<number>(0);
  return <main><h1>React + TSX OK</h1><button onClick={()=>setAmount(x=>x+1)}>React count {amount}</button></main>;
}
createRoot(document.querySelector('#root')!).render(<App/>);

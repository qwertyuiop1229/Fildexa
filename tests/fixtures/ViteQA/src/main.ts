import {getLabel} from '@/message';
import data from './data.json';
import './style.css';
interface Status { id: number, title: string }
const entry: Status = {id: 2, title: getLabel(data.topic)};
const el = document.querySelector<HTMLHeadingElement>('main h1')!;
el.textContent = entry.title;
el.dataset.env = import.meta.env.MODE;
console.info('TypeScript fixture:', entry);

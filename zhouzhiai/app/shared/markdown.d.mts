import type {Plugin} from 'unified';
import type {Root,Nodes} from 'mdast';
export const chineseStrong:Plugin<[],Root>;
export function parseMarkdown(value:string):Root;
export function formatMarkdown(value:string):string;
export function nodeText(node:Nodes):string;

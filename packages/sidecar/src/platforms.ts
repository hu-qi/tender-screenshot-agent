export type Platform = { id:string; name:string; url:string; loginMode:'public'|'manual_login'|'ca_login'; selectors:{search:string[]; result:string[]; detail:string[]} };
const generic={search:['input[placeholder*=项目]','input[placeholder*=关键]','input[type=search]','input[type=text]'],result:['a[href*="notice"]','a[href*="gg"]','table tbody tr','article'],detail:['article','.content','.notice-content','main']};
export const platforms:Platform[]=[
{id:'cmcc',name:'中国移动电子采购与招投标系统',url:'https://es.b2b.10086.cn/newbid/',loginMode:'manual_login',selectors:generic},
{id:'unicom',name:'中国联通合作方门户',url:'https://www.cuecp.cn/',loginMode:'manual_login',selectors:generic},
{id:'telecom',name:'中国电信电子采购平台',url:'https://caigou.chinatelecom.com.cn/',loginMode:'manual_login',selectors:generic},
{id:'tower-online-commerce',name:'中国铁塔在线商务平台',url:'https://www.tower.com.cn/',loginMode:'manual_login',selectors:generic},
{id:'tower-eprocurement',name:'中国铁塔电子采购平台',url:'https://ebid.chinatowercom.cn/',loginMode:'manual_login',selectors:generic},
{id:'cebpubservice',name:'中国招标投标公共服务平台',url:'https://bulletin.cebpubservice.com/',loginMode:'public',selectors:generic},
{id:'miit',name:'工信部通信工程建设项目招标投标管理信息平台',url:'https://txzbqy.miit.gov.cn/',loginMode:'manual_login',selectors:generic},
{id:'gd-govprocurement',name:'广东省政府采购网',url:'https://gdgpo.czt.gd.gov.cn/',loginMode:'public',selectors:generic},
{id:'gd-public-resources',name:'广东省公共资源交易平台',url:'https://ygp.gdzwfw.gov.cn/',loginMode:'public',selectors:generic}
];
export const getPlatform=(id:string)=>{const p=platforms.find(x=>x.id===id);if(!p)throw new Error(`unknown platform: ${id}`);return p};

const str={type:'string'},number={type:'number'},strings={type:'array',items:str};
const obj=properties=>({type:'object',properties,required:Object.keys(properties),additionalProperties:false});
const rect={x:number,y:number,width:number,height:number};
export const canvasPresentationSchema=obj({
 design:obj({rationale:str,background:str,textColor:str,accentColor:str,fontFamily:str}),
 assets:{type:'array',items:obj({id:str,kind:{type:'string',enum:['uploaded','brand','generated']},fileId:str,prompt:str,alt:str})},
 slides:{type:'array',maxItems:30,items:obj({layout:{type:'string',enum:['canvas']},title:str,background:str,notes:str,elements:{type:'array',maxItems:32,items:{anyOf:[
  obj({kind:{type:'string',enum:['text']},id:str,...rect,text:str,fontSize:number,bold:{type:'boolean'},color:str,role:{type:'string',enum:['title','body','caption']}}),
  obj({kind:{type:'string',enum:['image']},id:str,...rect,assetId:str,fit:{type:'string',enum:['contain','cover']},layer:{type:'string',enum:['background','content']}}),
  obj({kind:{type:'string',enum:['table']},id:str,...rect,headers:strings,rows:{type:'array',items:strings},columnWeights:{type:'array',items:number},fontSize:number}),
  obj({kind:{type:'string',enum:['chart']},id:str,...rect,chartType:{type:'string',enum:['bar','line']},categories:strings,series:{type:'array',items:obj({name:str,values:{type:'array',items:number}})},unit:str}),
 ]}}})},
});
export const presentationReviewSchema=obj({acceptable:{type:'boolean'},problems:strings,repairs:{type:'array',items:obj({index:{type:'integer'},slide:canvasPresentationSchema.properties.slides.items})}});
export const workbookSchema=obj({sheets:{type:'array',maxItems:8,items:obj({name:str,columns:{type:'array',maxItems:20,items:obj({label:str,kind:{type:'string',enum:['text','number','currency','percentage','date']}})},rows:{type:'array',maxItems:5000,items:{type:'array',items:{type:['string','number','boolean','null']}}}})}});
export const documentDeliveryInstructions=`按成果的实际用途组织内容，不照搬聊天口吻、段落或Markdown符号。Word的body使用完整Markdown结构：标题层级、自然段落、真实列表、必要表格；生成器会转成原生标题、加粗、列表、表格和分页，不能用空格画表或把正文放在代码围栏内。通知、简报不强加封面、编制说明或大段免责声明；报告保留关键依据和结论。Excel的workbook按实际工作需要规划最少的工作表，正文列不得塞入长报告；columns[].kind明确text/number/currency/percentage/date，数值用JSON数字、日期用真实完整YYYY-MM-DD，账号/编号用text，缺值用null或待确认，不能猜测日期、把未知值当零、把数值全写成字符串。workbook.rows列数必须与表头一致，保留全量记录、单位和来源；body只放必要简短说明，不重复整张表。不需要workbook时为null。Markdown文件保留有效结构和空行，不重复文件标题、套系统页脚或原样输出转义的排版字符。所有成果以事实为先，不编造数据、Logo、图片或引用。`;

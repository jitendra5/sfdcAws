var express        = require( 'express' );
var http           = require( 'http' );
var jsforce        = require('jsforce');
var bodyParser = require('body-parser');
var each = require('async-each');
//var async = require('asyncawait/async');
//var await = require('asyncawait/await');
const AWS = require('aws-sdk');
var app            = express();
//var async = require("async");
var log4js = require('log4js');
let tStamp =Date.now();
log4js.configure({ // configure to use all types in different files.
    appenders: {
        cheeseLogs: { type: 'file', base: 'logs/', filename: 'logs/debugLogs-'+tStamp+'.log' },
        console: { type: 'console' },
      },
     categories: {
        another: { appenders: ['console'], level: 'debug' },
        default: { appenders: [ 'console','cheeseLogs'], level: 'debug' }
    }
});

const log4js_extend = require("log4js-extend");

log4js_extend(log4js, {
    path: __dirname,
    format: "at @name (@file:@line:@column)"
  });

  var logger = log4js.getLogger('debug');

//const logger = log4js.getLogger("category");
//logger.level ='debug';

//const checkTable = require('./checkIfTableExists.js');

app.set( 'port', process.env.PORT || 5000 );
var jsonParser = bodyParser.json();
var urlencodedParser = bodyParser.urlencoded({ extended: false })
app.use(bodyParser.json({ type: 'application/json' }));
app.post('/api1.0/cloudbyz/sfdcObjects',urlencodedParser, function (req, res) {
    //logger.debug(req);
    logger.debug(req.body.objects);
    let sfdcObjects =req.body.objects;

  //We are trying to connect to any dynamoDB on any AWS instance.
  AWS.config.update({
    region: req.body.region,
    endpoint: req.body.endpoint,
    // accessKeyId default can be used while using the downloadable version of DynamoDB.
    // For security reasons, do not store AWS Credentials in your files. Use Amazon Cognito/ Http request.
    accessKeyId: req.body.accessKeyId,
    // secretAccessKey default can be used while using the downloadable version of DynamoDB.
    // For security reasons, do not store AWS Credentials in your files. Use Amazon Cognito/ Http request.
    secretAccessKey: req.body.secretAccessKey
});

//Now that we are authenticated with AWS, lets create an insatnce of Dynamodb to perform required operations.

var dynamodb = new AWS.DynamoDB({apiVersion: '2012-08-10'});
var counter=0;
let tableCounter =0;
let batchWriteCheck=0;

function getFirstHundredTables() {
    // Setting URL and headers for request
            var params={
                'Limit':100,
            };
            logger.debug(params);
    // Return new promise 
    return new Promise(function(resolve, reject) {
    	// Do async job by calling the DynamoDB.
        dynamodb.listTables(params, function(err, data) {
            if (err) {
                logger.debug(err);
                counter++;
                reject(err);
            }
            else {
                var tables= data.TableNames;
                //logger.debug(tables);
                logger.debug('Length: '+tables.length);
                counter++;
                resolve(data);
            }
        });
    })
}
function getNextHundredTables(lastTableName) {
    // Setting URL and headers for request
    var params;
    if(lastTableName === ''){
        params={
            'Limit':100
        };
    }
    else{
        params={
            'Limit':100,
            'ExclusiveStartTableName' : lastTableName
        };
    }
            logger.debug(params);
    // Return new promise 
    return new Promise(function(resolve, reject) {
    	// Do async job by calling the DynamoDB.
        dynamodb.listTables(params, function(err, data) {
            if (err) {
                logger.debug(err);
               //counter++;
                reject(err);
            }
            else {
                var tables= data.TableNames;
                //logger.debug(tables);
                logger.debug('Length: '+tables.length);
                //counter++;
                resolve(data);
            }
        });
    })
}
let sfdcConnFn =function callJSForce(tables){
    logger.debug('Calling JSFORCE now.!!!');
    return new Promise(function(resolve, reject) {
        var conn = new jsforce.Connection({
            // you can change loginUrl to connect to sandbox or prerelease env.
            loginUrl : 'https://login.salesforce.com'
            });
            conn.login('amazon.ctms@cloudbyz.com', 'Amazon@20193EN18u7qa9ZGQiT8Aofdwg7y', function(err, userInfo) {
            if (err) { 
                var resp={
                    con :'error',
                    status:'400'
                };
                reject(resp);
                console.error(err); 
            }
            else{
                //logger.debug(conn.instanceUrl);
                logger.debug("User ID: " + userInfo.id);
                logger.debug("Org ID: " + userInfo.organizationId);
                var resp={
                    con :conn,
                    status:'200',
                    tables:tables
                };
                resolve(resp);
            }//sucess conn else
            });//conn login fn.
    
    })
}
/*let splitArrayIntoChuncks = function chunkArray(myArray, chunk_size){
    logger.debug('Split Array is getting called...');
    var index = 0;
    var arrayLength = myArray.length;
    logger.debug('arrayLength: '+arrayLength);
    return new Promise((resolve,reject)=>{
    var tempArray = [];
    for (index = 0; index < arrayLength; index += chunk_size) {
        myChunk = myArray.slice(index, index+chunk_size);
        // Do something if you want with the group
        tempArray.push(myChunk);
    }
        logger.debug(tempArray.length);
        resolve(tempArray);
    });
}*/
let tableStatus = function verifyTables(sfdcObjects,dynamoTables){
    let objs= sfdcObjects.split(',');
    logger.debug(sfdcObjects);
    logger.debug(objs);
    var sfdcObjStatus=[];
    return new Promise((resolve,reject)=>{
        for(var i=0;i<objs.length;i++){
            let jsObj ={};
            if(dynamoTables.includes(objs[i])){
                jsObj[objs[i]] = 'TableExists';
                sfdcObjStatus.push(jsObj);
            }
            else{
                jsObj[objs[i]] = 'NoTable';
                sfdcObjStatus.push(jsObj);
            }
        }
        resolve(sfdcObjStatus);
    })
}
let tableAvailable = function isTableAvailable(tableName, avilStr){
    return new Promise((resolve,reject)=>{
        var params = {
            TableName: tableName 
          };
          dynamodb.waitFor(avilStr, params, function(err, data) {
            if (err) {
                logger.debug(err, err.stack); 
                reject(err);
            }
            else  {
                //logger.debug(data);
                resolve(data);
            }       
          });
    })
}
let crtTable = function createTable(tableName){
   // logger.debug('creating table for: '+ tableName);
    var params = {
        TableName : tableName,
        KeySchema: [
            {
                AttributeName: "Id", 
                KeyType: "HASH"
            }
        ],
        AttributeDefinitions: [
            {
                AttributeName: "Id", 
                AttributeType: "S"
            }
        ],
        ProvisionedThroughput: {
            ReadCapacityUnits: 20,
            WriteCapacityUnits: 20
        }
    };
    return new Promise((resolve,reject)=>{
        dynamodb.createTable(params, function(err, data) {
            if (err) {
                logger.debug(err, err.stack); 
                resolve({[tableName] : 'NotCreated'});
            }
            else {
                let isTableAvail =tableAvailable(tableName,'tableExists');
                isTableAvail.then(()=>{
                    resolve({[tableName] : 'created'});
                })
                
            }
    })
    
})
}
let deleteOps =function delTable(tableName){
    var params = { 
        TableName : tableName
    };
    return new Promise((resolve,reject)=>{
    dynamodb.deleteTable(params, function(err, data) {
        if (err) {
            logger.debug("Unable to delete table. Error JSON:", JSON.stringify(err, null, 2));
            resolve({[tableName] : 'NotDeleted','error':[err]});
        } else {
            logger.debug("Deleted table. Table description JSON:", JSON.stringify(data, null, 2));
            let isTableAvail =tableAvailable(tableName,'tableNotExists');
                isTableAvail.then(()=>{
                    //resolve({[tableName] : 'Deleted'});
                    logger.debug(tableName+ ' Deleted Successfully!!');
                    return crtTable(tableName);
                })
                .then((res)=>{
                    resolve(res);
                })
            }
    });
})
}
let bckTable = function backupTable(tableName){
    logger.debug('starting backup for table: '+ tableName);
    var params = {
        BackupName: tableName+'-backup', /* required */
        TableName: tableName /* required */
      };
      
    return new Promise((resolve,reject)=>{
        dynamodb.createBackup(params, function(err, data) {
            if (err) {
                logger.debug(tableName+':'+'NotBackedup');
                resolve({[tableName] : 'NotBackedup'});
            } 
            else   {
                logger.debug(tableName+':'+'Backedup'); 
                resolve({[tableName] : 'Backedup'});
            }          
          });
    })
}
let crtBckTable = function createOrBackupTable(tableObj){
    return new Promise((resolve,reject)=>{
        logger.debug(tableObj);
        logger.debug(typeof tableObj);
        logger.debug(Object.values(tableObj));
        if(Object.values(tableObj).includes('TableExists')){
            let backupTable = bckTable(Object.keys(tableObj)[0]);
            backupTable.then((backupRes)=>{
                resolve(backupRes);
            })
        }
        else if(Object.values(tableObj).includes('NoTable')){
            let createTable = crtTable(Object.keys(tableObj)[0]);
            createTable.then((createRes)=>{
                resolve(createRes);
            })
        }
    })
}

let chooseCreateOrDeleteCreate = function handleInsertData(tableObj,con,db){
    return new Promise((resolve,reject)=>{
        logger.debug(tableObj);
        logger.debug(typeof tableObj);
        logger.debug(Object.values(tableObj));
        if(Object.values(tableObj).includes('created')){
            let insertData = processData(Object.keys(tableObj)[0],con,db);
            insertData.then((insDataRes)=>{
                resolve(insDataRes);
            })
        }
        else if(Object.values(tableObj).includes('Backedup')){
            let deleteTable = deleteOps(Object.keys(tableObj)[0]);
            deleteTable.then((deleteRes)=>{
                let insertData = processData(Object.keys(tableObj)[0],con,db);
                insertData.then((insDataRes)=>{
                    resolve(insDataRes);
                })
            })
        }
    })

}
let tableOps = function createOrBackupObjects(tables){
    logger.debug('---TABLE OPS----');
      let createBackupTables = tables.map((table) =>crtBckTable(table));
      return Promise.all(createBackupTables);
}

let CRUDOps = function processDataObjects(tables,con,db){
    logger.debug('---CRUD OPS----');
      let crudTables = tables.map((table) =>chooseCreateOrDeleteCreate(table,con,db));
      return Promise.all(crudTables);
}

let sfdcFields = function getFieldsOfObject(tableName,con){
    logger.debug('272: Getting fields for: '+tableName );
    return new Promise((resolve,reject)=>{
        var fullNames = [tableName];

        con.describe(tableName, function(err, meta) {
            if (err) { 
                var emptyArr=[];
                console.error(err); 
                resolve(emptyArr);
            }
            else{
                //logger.debug('283: Object : ' + meta.label);
                var fields=[];
                for(var i=0;i<meta.fields.length;i++){
                fields.push(meta.fields[i].name);
                }
                logger.debug('288: count of fields: '+ fields.length);
                //logger.debug(fields);
                resolve(fields);
            }
          });
   })
}
/*let delayBatch = function avoidProvisonedThroughputError(dynamodb,params,msecs){
    setTimeout(()=>{
        return batchOps(dynamodb,params);
    },msecs)
}*/
/*let failedBatched=[];
let batchOps = function runBatch(dynamodb,params){
    //logger.debug(dynamodb);
    //logger.debug(params);
    return new Promise((resolve,reject)=>{
        //setTimeout(()=>{
            dynamodb.batchWriteItem(params, function(err, data) {
                if (err) {
                    logger.debug(err);
                    if(err.code =='ProvisionedThroughputExceededException'){
                        failedBatched.push(params);
                        //resolve('failed');
                        logger.debug(failedBatched);
                        logger.debug('HANDLING ProvisionedThroughputExceededException----');
                        /*setTimeout(()=>{
                            batchOps(dynamodb,params);
                            resolve(failedBatched);
                        },1000);*/
                    /*}
                    
                }
                else {
                    logger.debug(data);
                    var params = {};
                    params.RequestItems = data.UnprocessedItems; 
                    if(Object.keys(params.RequestItems).length != 0) {
                        setTimeout(()=>{
                            batchOps(dynamodb,params);
                        },1000);
                    }
                    else{
                        resolve('success');
                    }
                }    
            });
        //},200*backoff)
    })
}*/
/*let backoff=1;
let batchWriteAwsIterator= function insertBatch(tableName,split,con,dynamodb){
    return new Promise((resolve,reject)=>{
        logger.debug('Start of batch...'+ tableName);
                var params = {
                    RequestItems: {
                    },
                    'ReturnConsumedCapacity': 'INDEXES',
                };
                params.RequestItems[tableName] =[];
                for(var i=0;i<split.length;i++){
                    var recordKeys =[];
                    for(var k in split[i]) 
                        recordKeys.push(k);
                    var pRequest={};
                    var PutRequest={};
                    var Item ={};
                    for(var j=0;j<recordKeys.length;j++){
                        var field=recordKeys[j];
                        var value= split[i][field];
                        var valObj={};
                        if(value === undefined || value == null){
                            valObj['S']='NULL';
                        }
                        else{
                            valObj['S']=value.toString();
                        }
                        Item[field] =valObj;
                    }
                    PutRequest['Item']=Item;
                    pRequest['PutRequest'] =PutRequest;
                    params.RequestItems[tableName].push(pRequest);
                    }
                    var batchOpsCall = batchOps(dynamodb,params);
                    batchOpsCall.then((res)=>{
                        backoff++;
                        logger.debug('batch ops for '+ tableName+ ' : '+res);
                        resolve('Batch for Split Ended.'+tableName);
                    });
                    /*var slowDownBatch =delayBatch(dynamodb,params,500);
                    slowDownBatch.then((res)=>{
                        logger.debug('batch ops for '+ tableName+ ' : '+res);
                        resolve('Batch for Split Ended.'+tableName);
                    });*/
   // })
//}*/

/*let batchCheck=0;
let batchWriteAWS = function writeToAWS(tableName,data,con,dynamodb){
    let splitArray =[];
    return new Promise((resolve,reject)=>{
        let chuncks =splitArrayIntoChuncks(data.records,20);
        chuncks.then((res)=>{
            logger.debug(res.length);
            splitArray=res;
            //try introducing delay here and see if the batch iterator can also be slowed.
            let backoff=0;
            let runBatchIteratorOnEachChunck = splitArray.map((split,backoff) => {
                setTimeout(()=>{
                    batchWriteAwsIterator(tableName,split,con,dynamodb);
                },100*backoff);
                backoff++;
            });
             Promise.all(runBatchIteratorOnEachChunck).then((res)=>{
                 logger.debug(res);
                 resolve({[tableName]:'DataInserted'});
             });
             /*if(batchCheck < res.length){
                logger.debug('Inside batchCheck: '+ batchCheck + ' res.length: '+res.length );
                batchWriteAwsIterator(tableName,res[batchCheck],con,dynamodb);
                batchCheck++;
             }
             else{
                 logger.debug('All Chuncks inserted through batch...');
                 resolve('batch Success');
             }*/
       /* })
    })
}*/
let batchOps = function runBatch(dynamodb,params){
    //logger.debug(dynamodb);
    //logger.debug(params);
    return new Promise((resolve,reject)=>{
        dynamodb.batchWriteItem(params, function(err, data) {
            if (err) {
                logger.debug(err);
                resolve('failed');
            }
            else {
                logger.debug(data); 
                resolve('success');
            }    
        });
    })
}

let batchWriteAwsIterator = function insertBatch(objectName,start,end,dataLength,totalData,dynamodb,backoffVar){
    
    return new Promise((resolve,reject)=>{
        logger.debug('Start of batch, dataLength :'+ dataLength);
                var params = {
                    RequestItems: {
                    }
                };
                params.RequestItems[objectName] =[];
                for(var i=start;i<totalData.records.length && i< end;i++){
                    var recordKeys =[];
                    for(var k in totalData.records[i]) 
                        recordKeys.push(k);
                    var pRequest={};
                    var PutRequest={};
                    var Item ={};
                    for(var j=0;j<recordKeys.length;j++){
                        var field=recordKeys[j];
                        var value= totalData.records[i][field];
                        var valObj={};
                        if(value === undefined || value == null){
                            valObj['S']='NULL';
                        }
                        else{
                            valObj['S']=value.toString();
                        }
                        Item[field] =valObj;
                    }
                    PutRequest['Item']=Item;
                    pRequest['PutRequest'] =PutRequest;
                    //logger.debug(pRequest);
                    params.RequestItems[objectName].push(pRequest);
                    }
                    var batchOpsCall = batchOps(dynamodb,params);
                    var x = batchOpsCall.then((res)=>{
                        logger.debug('batch ops for '+ objectName+ ' : '+res);
                        if(dataLength - 25 > 0){
                            logger.debug('After batch ran, dataLength :'+ dataLength-end);
                            //setTimeout(()=>{
                                backoffVar++;
                                logger.debug('---->backoffVar: '+backoffVar);
                                return batchWriteAwsIterator(objectName,end,end+25,dataLength-25,totalData,dynamodb,backoffVar);
                            //},1000*backoffVar);
                            
                           
                        } 
                        else{
                            logger.debug('RESOLVED IN THE ITERATOR');
                            logger.debug(objectName);
                             //setTimeout(()=>{
                                return {[objectName] : 'success'};
                                //},1000);
                        }
                       
                    });
                    resolve(x);
    })
}

let batchWriteAWS = function writeToAWS(tableName,data,con,dynamodb){
    return new Promise((resolve,reject)=>{
        var count=0; var check25=25;
        if(data.records.length>0){
            let backoffVar=0;
            let batchCall =batchWriteAwsIterator(tableName,count,check25,data.records.length,data,dynamodb,backoffVar);
            //let xx= 
            batchCall.then((batchResult)=>{
                logger.debug(batchResult);
                //return batchResult;
                resolve(batchResult);
            });
            //resolve(xx);
        }
    })
}
function handleQueryMore(tableName,result,conn,dynamodb) {
    logger.debug('Inside handleQueryMore method---'+result);
    return new Promise((resolve,reject)=>{
        conn.queryMore(result, function(err, resultMore) {
        if (err) {
            logger.debug(err);
        }
        //do stuff with result
        else {
            //logger.debug('result: '+ result.records.length);
            logger.debug('resultMore: '+ resultMore.records.length);
            logger.debug('resultMore done: '+ resultMore.done);
            logger.debug('Next resultMore Record: '+ resultMore.records[0].Id);
            if(resultMore.records.length){
                var batchWriteAWSCall = new batchWriteAWS(tableName,resultMore,conn,dynamodb);  
                batchWriteAWSCall.then((res)=>{
                    if (!resultMore.done) //didn't pull all records
                    {
                    logger.debug('Next Result Record: '+ resultMore.records[0].Id);
                    logger.debug('next url: '+ resultMore.nextRecordsUrl);
                    return handleQueryMore(tableName,resultMore.nextRecordsUrl,conn,dynamodb);
                    }
                    else{
                        //return 'completed ';
                        resolve({[tableName]: 'DataInserted'});
                    }
                });
            }
            }
        });
    })
    
  }

let getData = function getDataForFields(tableName,con,dynamodb){
    
    return new Promise((resolve,reject)=>{
        logger.debug('Getting data for : '+ tableName);
        var fieldsForObject =[];
        let getFields =sfdcFields(tableName,con);
        getFields.then((fields)=>{
            fieldsForObject =fields;
            //logger.debug(fieldsForObject);
            if(fieldsForObject.length==0){
                resolve(tableName+ ':'+'NoDataInserted');
            }
            else{
                var soql='';
                for(var i=0;i<fieldsForObject.length;i++){
                    soql+=fieldsForObject[i]+',';
                }
                soql = soql.substring(0, soql.length - 1);
                soql = 'Select '+ soql+' From '+ tableName;
                logger.debug('soql: '+ soql);
                var records = [];
                con.query(soql, function(err, result) {
                if (err) { 
                    console.error(err);
                 }
                 else{
                    logger.debug(tableName+ ' result: '+ result.records.length);
                    logger.debug(tableName+' resultMore: '+ result.records.length);
                    logger.debug(tableName+' resultMore done: '+ result.done);
                    
                    var nextData =result.done;
                    if(result.done){
                        if(result.records.length >0){
                            var batchWriteAWSCall = new batchWriteAWS(tableName,result,con,dynamodb);  
                            batchWriteAWSCall.then((response)=>{
                                logger.debug(response);
                                resolve(response);
                            })
                        }
                    }
                    else{
                        logger.debug(tableName+' next url: '+ result.nextRecordsUrl);
                        if(result.records.length >0){
                            var batchWriteAWSCall = new batchWriteAWS(tableName,result,con,dynamodb);  
                            batchWriteAWSCall.then((response)=>{
                                logger.debug(response);
                                return handleQueryMore(tableName,result.nextRecordsUrl,con,dynamodb);
                            })
                            .then((handleQueryMoreRes)=>{
                                logger.debug(handleQueryMoreRes);
                                resolve(handleQueryMoreRes);
                            })
                        }
                    }
                     
                 }//else
                });
            }
        })
    })
}

let processData = function formatDataForBatchWriteOps(table,con,dynamodb){
    logger.debug('PROCESS DATA FOR CREATED TABLE.....: '+table);
    return new Promise((resolve,reject)=>{
            let getDataCall = getData(table,con,dynamodb);
            getDataCall.then((getDataCallResp)=>{
                logger.debug('Data Processes completed for: '+ table);
                resolve(getDataCallResp);
            })
    })
}
var userDetails=[];

let getExistingDynamoDbTables = function getTables(lastTableName){
    return new Promise((resolve,reject)=>{
        let first100Tables =getNextHundredTables();
        first100Tables.then((result)=>{
            if(result !== undefined && result.hasOwnProperty('TableNames')){
                logger.debug("Fetched "+result.TableNames.length+" tables..");
                userDetails = userDetails.concat(result.TableNames);
                //logger.debug( result);
                logger.debug("result.LastEvaluatedTableName: "+ result.LastEvaluatedTableName);
                logger.debug("result.TableNames.length: "+ result.TableNames.length);
                if(result.LastEvaluatedTableName !='' && result.TableNames.length==100){
                    return getNextHundredTables(result.LastEvaluatedTableName);
                }
                else{
                    resolve(userDetails);
                }
            }
            else{
                resolve(userDetails);
            }
        })
        .then((result)=>{
            //next hundered tables
            if(result !== undefined && result.hasOwnProperty('TableNames')){
                logger.debug("Fetched "+result.TableNames.length+" tables..");
                userDetails = userDetails.concat(result.TableNames);
                logger.debug("result.LastEvaluatedTableName: "+ result.LastEvaluatedTableName);
                logger.debug("result.TableNames.length: "+ result.TableNames.length);
                if(result.LastEvaluatedTableName !='' && result.TableNames.length==100){
                    return getNextHundredTables(result.LastEvaluatedTableName);
                }
                else{
                    resolve(userDetails);
                }

            }
            else{
                resolve(userDetails);
            }
            
        })
        .then((result)=>{
            //next 56 tables. As DynamoDb has max. 256 tables.
            if(result!==undefined && result.hasOwnProperty('TableNames')){
                logger.debug("Fetched "+result.TableNames.length+" tables..");
                userDetails = userDetails.concat(result.TableNames);
                logger.debug("result.LastEvaluatedTableName: "+ result.LastEvaluatedTableName);
                logger.debug("result.TableNames.length: "+ result.TableNames.length);
                resolve(userDetails);
            }
            else{
                resolve(userDetails);
            }
            
        })
        .catch((error)=>{
            logger.debug(error);
        })

    });
}

function main() {
    var con;
    var db =dynamodb;
    let getTables = getExistingDynamoDbTables();
    var totalTables=[];
    getTables.then((result)=>{
        logger.debug("#####Finally total fetched Tables: "+result.length);
        //logger.debug(result);
        return sfdcConnFn(result);
    })
    .then((result)=>{
        //logger.debug(result);
        logger.debug('####SFDC con status: '+result.status);
        if(result.status !='400'){
            con = result.con;
            totalTables = totalTables.concat(result.tables);
            return tableStatus(sfdcObjects,result.tables);
        }
    })
    .then((tableStatus)=>{
        logger.debug('Selected objects will classified wheather they have a table in Dynamodb or not..');
        logger.debug(tableStatus);
        return tableOps(tableStatus);
    })
    .then((tableOpsResult)=>{
        logger.debug('Tables will be created if doesnt exist or will be Backedup if present...');
        logger.debug(tableOpsResult);
       return CRUDOps(tableOpsResult,con,db);

    })
    .then((result)=>{
        logger.debug('LAST...');
        logger.debug(result);
        //res.end(result);
    })
    .catch((error)=>{
        logger.debug(error);
    })

}

//starting the Event loop execution.
main();


});
app.get('/api1.0/cloudbyz/test',urlencodedParser, function (req, res) {
    res.send(JSON.stringify({'Status': 'SFDC-DynamoDB REST-API Running in AWS','Response':'200'}));
});
app.post('/api1.0/cloudbyz/verifyAws',urlencodedParser, function (req, res) {
    logger.debug('l599: '+req.body.objects);
    AWS.config.update({
        region: req.body.region,
        endpoint: req.body.endpoint,
        // accessKeyId default can be used while using the downloadable version of DynamoDB.
        // For security reasons, do not store AWS Credentials in your files. Use Amazon Cognito/ Http request.
        accessKeyId: req.body.accessKeyId,
        // secretAccessKey default can be used while using the downloadable version of DynamoDB.
        // For security reasons, do not store AWS Credentials in your files. Use Amazon Cognito/ Http request.
        secretAccessKey: req.body.secretAccessKey
    });
    var dynamodb = new AWS.DynamoDB({apiVersion: '2012-08-10',maxRetries: 15, retryDelayOptions: {base: 500}});
    var request = dynamodb.listTables();
    request.send();
    request.on('success', function(response) {
    console.log('l599: '+"Success!");
    res.send(JSON.stringify({'Status': 'AWS credentials are Verified.','statusCode':'200'}));
  }).on('error', function(error, response) {
    console.log('l617: '+error);
    res.send(JSON.stringify({'Status': error.message ,'statusCode':error.statusCode}));
  });
    
});
http.createServer( app ).listen( app.get( 'port' ), function (){
  logger.debug( '######Cloudbyz Express server listening on port: ' + app.get( 'port' ));
});


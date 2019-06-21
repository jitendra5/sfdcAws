var express        = require( 'express' );
var http           = require( 'http' );
var jsforce        = require('jsforce');
var bodyParser = require('body-parser')
const AWS = require('aws-sdk');
var app            = express();
var async = require('asyncawait/async');
var await = require('asyncawait/await');

const checkTable = require('./checkIfTableExists.js');
console.log(checkTable);

app.set( 'port', process.env.PORT || 5000 );
var jsonParser = bodyParser.json();
var urlencodedParser = bodyParser.urlencoded({ extended: false })
app.use(bodyParser.json({ type: 'application/json' }));
app.get('/cloudbyzv1.0/sfdcObjects',urlencodedParser, function (req, res) {
    //console.log(req);
    console.log(req.body.objects);
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
var dynamodb = new AWS.DynamoDB();
var counter=0;
let tableCounter =0;

function getFirstHundredTables() {
    // Setting URL and headers for request
            var params={
                'Limit':100,
            };
            console.log(params);
    // Return new promise 
    return new Promise(function(resolve, reject) {
    	// Do async job by calling the DynamoDB.
        dynamodb.listTables(params, function(err, data) {
            if (err) {
                console.log(err);
                counter++;
                reject(err);
            }
            else {
                var tables= data.TableNames;
                //console.log(tables);
                console.log('Length: '+tables.length);
                counter++;
                resolve(data);
            }
        });
    })
}
function getNextHundredTables(lastTableName) {
    // Setting URL and headers for request
            var params={
                'Limit':100,
                'ExclusiveStartTableName' : lastTableName
            };
            console.log(params);
    // Return new promise 
    return new Promise(function(resolve, reject) {
    	// Do async job by calling the DynamoDB.
        dynamodb.listTables(params, function(err, data) {
            if (err) {
                console.log(err);
                counter++;
                reject(err);
            }
            else {
                var tables= data.TableNames;
                //console.log(tables);
                console.log('Length: '+tables.length);
                counter++;
                resolve(data);
            }
        });
    })
}
let sfdcConnFn =function callJSForce(){
    console.log('Calling JSFORCE now.!!!');
    return new Promise(function(resolve, reject) {
        var conn = new jsforce.Connection({
            // you can change loginUrl to connect to sandbox or prerelease env.
            loginUrl : 'https://login.salesforce.com'
            });
            conn.login('amazon.ctms@cloudbyz.com', 'Amazon@20193EN18u7qa9ZGQiT8Aofdwg7y', function(err, userInfo) {
            if (err) { 
                reject('Salesforce connection rejected.');
                console.error(err); 
            }
            else{
                //console.log(conn.instanceUrl);
                console.log("User ID: " + userInfo.id);
                console.log("Org ID: " + userInfo.organizationId);
                resolve(conn);
            }//sucess conn else
            });//conn login fn.
    
    })
}
let tableStatus = function verifyTables(sfdcObjects,dynamoTables){
    let objs= sfdcObjects.split(',');
    console.log(sfdcObjects);
    console.log(objs);
    //console.log(dynamoTables);
    var sfdcObjStatus={};
    return new Promise((resolve,reject)=>{
        for(var i=0;i<objs.length;i++){
            if(dynamoTables.includes(objs[i])){
                sfdcObjStatus[objs[i]] = 'TableExists';
            }
            else{
                sfdcObjStatus[objs[i]] = 'NoTable';
            }
        }
        resolve(sfdcObjStatus);
    })
}
let tableAvailable = function isTableAvailable(tableName){
    return new Promise((resolve,reject)=>{
        var params = {
            TableName: tableName 
          };
          dynamodb.waitFor('tableExists', params, function(err, data) {
            if (err) {
                console.log(err, err.stack); 
                reject(err);
            }
            else  {
                console.log(data);
                resolve(data);
            }       
          });
    })
}
let crtTable = function createTable(tableName){
    console.log('creating table for: '+ tableName);
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
            ReadCapacityUnits: 10,
            WriteCapacityUnits: 10
        }
    };
    return new Promise((resolve,reject)=>{
        dynamodb.createTable(params, function(err, data) {
            if (err) {
                console.log(err, err.stack); 
                resolve(tableName+':'+'NotCreated');
            }
            else {
                console.log('Table created.');
                //console.log(data);
                let isTableAvail =tableAvailable(tableName);
                isTableAvail.then(()=>{
                    resolve(tableName+':'+'created');
                })
                
            }
    })
    
})
}
let bckTable = function backupTable(tableName){
    console.log('starting backup for table: '+ tableName);
    var params = {
        BackupName: tableName+'-backup', /* required */
        TableName: tableName /* required */
      };
      
    return new Promise((resolve,reject)=>{
        dynamodb.createBackup(params, function(err, data) {
            if (err) {
                console.log(tableName+':'+'NotBackedup');
                resolve(tableName+':'+'NotBackedup');
            } 
            else   {
                console.log(tableName+':'+'Backedup'); 
                resolve(tableName+':'+'Backedup');
            }          
          });
          
    })
}
let tableOps = function createOrBackupTable(tables){
    console.log('---TABLE OPS----');
    console.log(tables);
    let tableOpsResult ={};
    let tableKeys=[];
    for (var key in tables) {
        if (tables.hasOwnProperty(key)) {
            console.log(key + " -> " + tables[key]);
            tableKeys.push(key);
        }
    }
    console.log(tableKeys);
    return new Promise((resolve,reject)=>{
        let k=0;
        let totalKeyslen =tableKeys.length;
        let tableIter =function(tableName){
            if(k<totalKeyslen){
                var keyVal =tableKeys[k];
                console.log('keyVal: '+ keyVal);
                console.log('tables[keyVal]: '+ tables[keyVal]);
                if(tables[keyVal] === 'TableExists'){
                    console.log('--> INSIDE Backup TABLE');
                    var backupTable = bckTable(tableName);
                    backupTable.then((backupTableResp)=>{
                        console.log(tableName+' Backedup Successfully!!!!');
                        var resp = backupTableResp.split(':');
                        tableOpsResult[resp[0]]=resp[1];
                        k++;
                        if(k<totalKeyslen){
                            let nexttable =tableKeys[k];
                            tableIter(nexttable);
                        }
                        else{
                            resolve(tableOpsResult);
                        }
                    })
                }
                else if(tables[keyVal]=='NoTable'){
                    console.log('--> INSIDE NO TABLE');
                    var createTable = crtTable(tableName);
                    createTable.then((createTableResp)=>{
                        //console.log(createTableResp);
                        var resp = createTableResp.split(':');
                        tableOpsResult[resp[0]]=resp[1];
                        console.log(tableName+' created Successfully!!!!');
                        k++;
                        if(k<totalKeyslen){
                            let nexttable =tableKeys[k];
                            tableIter(nexttable);
                        }
                        else{
                            resolve(tableOpsResult);
                        }
                        
                    })
                } 
            }
        }
        console.log('266: tableKeys[0]: '+ tableKeys[0]);
        tableIter(tableKeys[0]);
    })

}
let sfdcFields = function getFieldsOfObject(tableName,con){
    console.log('272: Getting fields for: '+tableName );
    return new Promise((resolve,reject)=>{
        var fullNames = [tableName];

        con.describe(tableName, function(err, meta) {
            if (err) { 
                var emptyArr=[];
                console.error(err); 
                resolve(emptyArr);
            }
            else{
                //console.log('283: Object : ' + meta.label);
                var fields=[];
                for(var i=0;i<meta.fields.length;i++){
                fields.push(meta.fields[i].name);
                }
                console.log('288: count of fields: '+ fields.length);
                //console.log(fields);
                resolve(fields);
            }
          });
   })
}
let batchOps = function runBatch(dynamodb,params){
    return new Promise((resolve,reject)=>{
        dynamodb.batchWriteItem(params, function(err, data) {
            if (err) {
                console.log(err);
                resolve('failed');
            }
            else {
                console.log(data); 
                resolve('success');
            }    
        });
    })
}
let batchWriteAwsIterator = function insertBatch(objectName,start,end,dataLength,totalData,dynamodb){
    return new Promise((resolve,reject)=>{
        console.log('Start of batch, dataLength :'+ dataLength);
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
                    //console.log(pRequest);
                    params.RequestItems[objectName].push(pRequest);
                    }
                    var batchOpsCall = batchOps(dynamodb,params);
                    batchOpsCall.then((res)=>{
                        console.log('batch ops for '+ objectName+ ' : '+res);
                        if(dataLength - 25 > 0){
                            console.log('After batch ran, dataLength :'+ dataLength-end);
                            batchWriteAwsIterator(objectName,end,end+25,dataLength-25,totalData,dynamodb);
                        } 
                        else{
                            resolve({objectName : 'success'});
                        }
                    })
                    
    })
}
let batchWriteAWS = function writeToAWS(tableName,data,con,dynamodb){
    return new Promise((resolve,reject)=>{
        var count=0; var check25=25;
        if(data.records.length>0){
            let batchCall =batchWriteAwsIterator(tableName,count,check25,data.records.length,data,dynamodb);
            batchCall.then((batchResult)=>{
                console.log(batchResult);
                resolve(batchResult);
            })
        }
    })
}
let getData = function getDataForFields(tableName,con,dynamodb){
    
    return new Promise((resolve,reject)=>{
        console.log('298: Getting data for : '+ tableName);
        var fieldsForObject =[];
        let getFields =sfdcFields(tableName,con);
        getFields.then((fields)=>{
            fieldsForObject =fields;
            //console.log(fieldsForObject);
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
                console.log('314: soql: '+ soql);
                var records = [];
                con.query(soql, function(err, result) {
                if (err) { 
                    return console.error(err);
                 }
                 else{
                     //console.log("fetched : " + result.records.length);
                     var batchWriteAWSCall = new batchWriteAWS(tableName,result,con,dynamodb);  
                     batchWriteAWSCall.then((fresult)=>{
                        resolve(fresult);
                     })
                    
                 }
                //console.log(result.records);
                //console.log("total : " + result.totalSize);
                
                });
            }
        })
    })
}
let processData = function formatDataForBatchWriteOps(tables,con,dynamodb){
    console.log('328: Process DATA FOR CREATED TABLES.....');
    console.log(tables);
    let dataOpsResult ={};
    let noTables =tables.length;
    console.log('332: No. of Tables: '+ noTables);
    console.log('333. tableCounter now: '+ tableCounter);
    return new Promise((resolve,reject)=>{
        if(tableCounter<noTables){
            let getDataCall = getData(tables[tableCounter],con,dynamodb);
            getDataCall.then((getDataCallResp)=>{
                tableCounter++;
                console.log('338: tablecounter: '+tableCounter);
                processData(tables,con,dynamodb);
            })
        }
        else{
            resolve('Success');
        }
       
    })
}

let insetOpsBackedupTables = function insertDataForTablesBackedup(tables){
    console.log('INSIDE INSERT DATA FOR BACKEDUP TABLES.....');
    let dataOpsResult ={};
    console.log(tables);
    return new Promise((resolve,reject)=>{
        
    })

}

var userDetails=[];

function main(lastTableName) {
    var con;
//this function should return a promise, we resolve or reject it based on a condition.
    var first100Tables = getFirstHundredTables(lastTableName);
    first100Tables.then(function(result) {
        console.log("Fetched first 100 tables..");
        userDetails = userDetails.concat(result.TableNames);
        // Use user details from here
            if(result.LastEvaluatedTableName !='' && result.TableNames.length==100){
                var  checkNext100Tables = getNextHundredTables(result.LastEvaluatedTableName);
                checkNext100Tables.then(function(result){
                    userDetails = userDetails.concat(result.TableNames);
                    console.log("Fetched tables from 101 t0 200...");
                    if(result.LastEvaluatedTableName !='' && result.TableNames.length==100){
                        var checkForTables = getNextHundredTables(result.LastEvaluatedTableName);
                        checkForTables.then(function(result){
                            console.log("Fetched tables from 200 t0 256...");
                            userDetails = userDetails.concat(result.TableNames);
                            console.log(userDetails);
                            console.log('userDetails length: '+ userDetails.length);
                            console.log("Cretaing sfdc conn after fetching 256 tables....");
                            var sfdcCon =sfdcConnFn();
                            sfdcCon.then(function(con) {
                                console.log('connection url: '+ con.instanceUrl);
                                con=con;
                                let sfdbStatus = tableStatus(sfdcObjects,userDetails);
                                sfdbStatus.then(function(response){
                                    console.log(response);
                                    let tableOperations = tableOps(response);
                                    tableOperations.then((tableOpsResult)=>{
                                        console.log('---tableOpsResult---');
                                        console.log(tableOpsResult);
                                        let keysOfCreatedTables=[];
                                        let keysOfBackupedTables=[];
                                        for (var key in tableOpsResult) {
                                            if (tableOpsResult.hasOwnProperty(key)) {
                                                console.log(key + " -> " + tableOpsResult[key]);
                                                if(tableOpsResult[key]=='created' || tableOpsResult[key]=='NotCreated'){
                                                    keysOfCreatedTables.push(key);
                                                }
                                                else if(tableOpsResult[key]=='NotBackedup'|| tableOpsResult[key]=='Backedup'){
                                                    keysOfBackupedTables.push(key);
                                                }
                                                
                                            }
                                        }
                                        console.log('keysOfCreatedTables: '+ keysOfCreatedTables );
                                        console.log('keysOfBackupedTables: '+ keysOfBackupedTables );
                                        let processDataOps = processData(keysOfCreatedTables,con,dynamodb);
                                        processDataOps.then((processDataOpsRes)=>{
                                            console.log(processDataOpsRes.length);
                                        })
                                    })
                                })
                            })
                        })
                    }
                    else{
                        console.log("Cretaing sfdc conn after fetching 200 tables....");
                        var sfdcCon =sfdcConnFn();
                        sfdcCon.then(function(result) {
                            console.log('connection url: '+ result.instanceUrl);
                            con=result;
                            let sfdbStatus = tableStatus(sfdcObjects,userDetails);
                                sfdbStatus.then(function(response){
                                    console.log(response);
                                    let tableOperations = tableOps(response);
                                    tableOperations.then((tableOpsResult)=>{
                                        console.log('---tableOpsResult---');
                                        console.log(tableOpsResult);
                                        let keysOfCreatedTables=[];
                                        let keysOfBackupedTables=[];
                                        for (var key in tableOpsResult) {
                                            if (tableOpsResult.hasOwnProperty(key)) {
                                                console.log(key + " -> " + tableOpsResult[key]);
                                                if(tableOpsResult[key]=='created' || tableOpsResult[key]=='NotCreated'){
                                                    keysOfCreatedTables.push(key);
                                                }
                                                else if(tableOpsResult[key]=='NotBackedup'|| tableOpsResult[key]=='Backedup'){
                                                    keysOfBackupedTables.push(key);
                                                }
                                                
                                            }
                                        }
                                        console.log('keysOfCreatedTables: '+ keysOfCreatedTables );
                                        console.log('keysOfBackupedTables: '+ keysOfBackupedTables );
                                        let processDataOps = processData(keysOfCreatedTables,con,dynamodb);
                                        processDataOps.then((processDataOpsRes)=>{
                                            console.log(processDataOpsRes.length);
                                        })
                                    })
                                })
                        })
                    }
                })
            }
            else{
                console.log("Cretaing sfdc conn after fetching 100 tables....");
                var sfdcCon =sfdcConnFn();
                sfdcCon.then(function(result) {
                    console.log('connection url: '+ result.instanceUrl);
                    con= result;
                    let sfdbStatus = tableStatus(sfdcObjects,userDetails);
                                sfdbStatus.then(function(response){
                                    console.log(response);
                                    let tableOperations = tableOps(response);
                                    tableOperations.then((tableOpsResult)=>{
                                        console.log('---tableOpsResult---');
                                        console.log(tableOpsResult);
                                        let keysOfCreatedTables=[];
                                        let keysOfBackupedTables=[];
                                        for (var key in tableOpsResult) {
                                            if (tableOpsResult.hasOwnProperty(key)) {
                                                console.log(key + " -> " + tableOpsResult[key]);
                                                if(tableOpsResult[key]=='created' || tableOpsResult[key]=='NotCreated'){
                                                    keysOfCreatedTables.push(key);
                                                }
                                                else if(tableOpsResult[key]=='NotBackedup'|| tableOpsResult[key]=='Backedup'){
                                                    keysOfBackupedTables.push(key);
                                                }
                                                
                                            }
                                        }
                                        console.log('keysOfCreatedTables: '+ keysOfCreatedTables );
                                        console.log('keysOfBackupedTables: '+ keysOfBackupedTables );
                                        let processDataOps = processData(keysOfCreatedTables,con,dynamodb);
                                        processDataOps.then((processDataOpsRes)=>{
                                            console.log(processDataOpsRes.length);
                                        })

                                    })
                                })
                })
            }
            
    }, function(err) {
        console.log(err);
    })
}

//starting the thread execution.
main();





});

http.createServer( app ).listen( app.get( 'port' ), function (){
  console.log( 'Express server listening on port ' + app.get( 'port' ));
});


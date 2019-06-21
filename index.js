//We require AWS SDK.
const AWS = require('aws-sdk');
var http = require('http');
const jsforce = require('jsforce');
let SalesforceConnection = require("node-salesforce-connection");
const checkTable = require('./checkIfTableExists.js');
//console.log(jsforce);
console.log(checkTable);
//This handler function handles the incoming request.
exports.handler = function(event, context) {

    //We are trying to connect to any dynamoDB on any AWS instance.
    AWS.config.update({
        region: event['region'],
        endpoint: event['endpoint'],
        // accessKeyId default can be used while using the downloadable version of DynamoDB.
        // For security reasons, do not store AWS Credentials in your files. Use Amazon Cognito/ Http request.
        accessKeyId: event['accessKeyId'],
        // secretAccessKey default can be used while using the downloadable version of DynamoDB.
        // For security reasons, do not store AWS Credentials in your files. Use Amazon Cognito/ Http request.
        secretAccessKey: event['secretAccessKey']
    });
    
    //Now that we are authenticated with AWS, lets create an insatnce of Dynamodb to perform required operations.
    var dynamodb = new AWS.DynamoDB();
    
    var params = {};
    //
    dynamodb.listTables(params, function(err, data) {
        if (err) {
            let response = {
                statusCode: 400,
                body: JSON.stringify(err),
                headers: {
                    'Content-Type': 'application/json',
                }
            };
            context.fail('ERROR: Dynamo failed: ' + err);
        }
        else {
            console.log(data);
            //let checks= checkTable.checkTableModule;
            //let returnValue= checks(data);
            let result=[];
            
            var conn = new jsforce.Connection({
            // you can change loginUrl to connect to sandbox or prerelease env.
            loginUrl : 'https://amazonwebservice-dev-ed.my.salesforce.com'
            });
            conn.login('amazon.ctms@cloudbyz.com', 'Amazon@20193EN18u7qa9ZGQiT8Aofdwg7y', function(err, userInfo) {
            if (err) { return console.error(err); }
            // Now you can get the access token and instance URL information.
            // Save them to establish connection next time.
            console.log(conn.accessToken);
            console.log(conn.instanceUrl);
            // logged in user property
            console.log("User ID: " + userInfo.id);
            console.log("Org ID: " + userInfo.organizationId);

                var records = [];
                conn.query("SELECT Id, Name FROM Account", function(err, result) {
                if (err) { return console.error(err); }
                console.log("total : " + result.totalSize);
                console.log("fetched : " + result.records.length);
                result.push(result.totalSize);
                });
            // ...
            });
             
              let response = {
                statusCode: 200,
                body: data,
                checkTables: result,
                headers: {
                    'Content-Type': 'application/json',
                }
            };

            context.succeed(response);
            
        }
    });
}

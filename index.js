"use strict";

const functions = require('firebase-functions');
const { WebhookClient } = require('dialogflow-fulfillment');

process.env.DEBUG = 'dialogflow:debug';

const CONTEXT_NAME = 'playing';

/**
 * safely gets the (deep) property of an object
 * 
 * @param {any} obj 
 * @param  {...string} propNames 
 * @return {any} res
 */
const prop = (obj, ...propNames) => {
    if (!obj)
        return null;
    
    let res = obj;
    for (let name of propNames) {
        if (!res)
            break;

        res = res[name];
    }

    return res;
};

const handleFalselyRequest = (/** @type{string} */reason) => (/** @type{Request} */request, /** @type{Response} */response) => {
    if (typeof response.status === 'function')
        response.statusCode = 400;
    else 
        response.status = 400;
    
    return response.send({
        message: reason
    });
};

const handleRequest = (/** @type{Request} */request, /** @type{Response} */response) => {
    /** @type{string} */
    const intentDisplayName = prop(request.body, 'queryResult', 'intent', 'displayName');
    if (!intentDisplayName)
        return handleFalselyRequest('Invalid request, missing `queryResult.intent.displayName`. The request is probably not a request from Dialogflow or Actions on Google')(request, response); // intent name was not resolved
    
    const fulfillmentMessages = prop(request.body, 'queryResult', 'fulfillmentMessages');
    if (!fulfillmentMessages)
        return handleFalselyRequest(`The request for intent '${intentDisplayName}' was not from DialogFlow or Actions on Google`)(request, response); // missing fulfillment messages on request

    const client = new WebhookClient({ request, response });

    const ctx = client.getContext(CONTEXT_NAME);
    if (!ctx)
        return response.send({ fulfillmentMessages }); // return the request from DF or AOG when the required context is missing
    
    /** @type{string} */
    const query = prop(request.body, 'queryResult', 'queryText');
    
    client.handleRequest((agent) => handleResponse(agent.clearContext(CONTEXT_NAME), query.trim().toLowerCase(), ctx));
};

/**
 * handles the response
 * 
 * @param {WebhookClient} agent 
 * @param {string} query
 * @param {*} ctx
 */
function handleResponse(agent, query, { name, parameters } = ctx) {
    const newWords = parseQuery(query);

    /** @type{string[]} */
    let { words = [] } = parameters || {};

    if (newWords.length !== 0) {
        if (containsAll(words, newWords)) {
            const requiredLength = words.length + 1;
            if (words.length === 0 || newWords.length === requiredLength) {
                if (words.length === 0 && newWords.length > 1)
                    return agent.setContext({
                        name,
                        lifespan: 1
                    }).add([
                        'I can\'t remember more than one item at a time',
                        'Let\'s just start over',
                        'What item should I bring with me?'
                    ]);
                else
                    words = newWords;
            } else {
                let reason;
                if (words.length === newWords.length)
                    reason = `You\'ve only said the same items and forgot to add a new one`;
                else if (newWords.length > requiredLength)
                    reason = `You\'ve mentioned ${newWords.length - requiredLength} too many items`;

                return agent.add([reason, query, ...newWords]);
            }
        } else
            return agent.add([`You didn\'t say all the previous items`, query, ...newWords]);
    }

    return agent.setContext({
        name,
        lifespan: 1,
        parameters: parameters ? Object.assign(parameters, { words }) : { words }
    }).add([
        `So all that you want to bring ${newWords.length === 1 ? 'is' : 'are'}:`,
        ...newWords.map(s => {
            const prefix = ['a', 'e', 'i', 'o', 'u'].includes(s[0]) ? 'an' : 'a';
            return `${prefix} ${s},`;
        }),
        `And what else?`
    ]);
}

/**
 * parses the query input by removing 
 * @param {string} query
 * @return {string[]} query 
 */
function parseQuery(query) {
    return query
        .replace(/[\.\,]/g, '')             // remove punctuation
        .replace(/((the|a|an)\s+)/g, '')    // remove articles
        .split(' ');                        // split words on space
}

/**
 * Compares all items the items in the second array are equal to the ones in the first
 * 
 * @param {Array<T>} arr0
 * @param {Array<T>} arr1
 * @return {bool}
 */
function containsAll(arr0, arr1) {
    if (!Array.isArray(arr0) || !Array.isArray(arr1) || arr1.length < arr0.length)
        return false;

    return arr0.filter(item => arr1.includes(item)).length === arr0.length;
}

exports.dialogflowFirebaseFulfillment = functions.https.onRequest(handleRequest);
import { parentPort } from 'worker_threads'
import { of } from 'hyper-async'
import { z } from 'zod'

import { createApis, domainConfigSchema, createLogger } from '../../index.js'
import { config } from '../../../config.js'
import { dataStoreClient } from '../../index.js'
import { dbInstance } from '../../index.js'

const logger = createLogger('ao-mu-worker')

const apiCtx = {
  ...(domainConfigSchema.parse(config)),
  fetch,
  logger
}

let apis = createApis(apiCtx)

const monitorSchema = z.object({
  id: z.string(),
  authorized: z.boolean(),
  lastFromSortKey: z.nullable(z.string()), 
  interval: z.string(), 
  block: z.any(),
  createdAt: z.number(), 
});

const findLatestMonitors = dataStoreClient.findLatestMonitorsWith({dbInstance, logger})
const saveMsg = dataStoreClient.saveMsgWith({dbInstance, logger})
const findLatestMsgs = dataStoreClient.findLatestMsgsWith({dbInstance, logger})
const updateMonitor = dataStoreClient.updateMonitorWith({dbInstance, logger})

parentPort.on('message', (message) => {
  if(message.label === 'start') {
    setInterval(() => processMonitors(), 1000)
    parentPort.postMessage(`Monitor worker started`)
  } else {
    parentPort.postMessage(`Invalid message`)
  }
})

let runningMonitorList = []

async function processMonitors() {
  try {
    let monitorList = await findLatestMonitors()
  
    monitorList.map((monitor) => {
      const validationResult = monitorSchema.safeParse(monitor);

      if (validationResult.success) {
        if (shouldRun(monitor)) {
          processMonitor(monitor).then((result) => {
            const indexToRemove = runningMonitorList.findIndex(
              (item) => item.id === monitor.id
            );
            if (indexToRemove !== -1) {
              runningMonitorList.splice(indexToRemove, 1);
            }
          });
        }
      } else {
        console.error('Invalid monitor:', validationResult.error);
      }
    })
  } catch(e) {
    if(e !== 'No documents found') {
      console.log(e)
    }
  }
}

async function fetchScheduled(monitor) {
  let lastFromSortKey = monitor.lastFromSortKey;
  let requestUrl = `${config.CU_URL}/scheduled/${monitor.id}`;

  if (lastFromSortKey) {
    requestUrl = `${config.CU_URL}/scheduled/${monitor.id}?from=${lastFromSortKey}`;
  }

  try {
    let response = await fetch(requestUrl);
    let scheduled = await response.json();
    return scheduled;
  } catch (error) {
    console.log('Error in fetchScheduled:', error);
    console.log('for monitor: ')
    console.log(monitor)
  }
}


async function processMonitor(monitor) {
    runningMonitorList.push(monitor)

    try {
      let scheduled = await fetchScheduled(monitor)

      if(!scheduled || scheduled.length < 1) return [];
  
      let fromTxId = `scheduled-${Math.floor(Math.random() * 1e18).toString()}`
  
      const savePromises = scheduled.map(msg => {
        const msgWithoutScheduledSortKey = { ...msg };
        delete msgWithoutScheduledSortKey.scheduledSortKey;
        return saveMsg({
          id: Math.floor(Math.random() * 1e18).toString(),
          fromTxId: fromTxId,
          msg: msgWithoutScheduledSortKey,
          cachedAt: new Date()
        })
      })
  
      await Promise.all(savePromises)
      let dbMsgs = await findLatestMsgs({fromTxId})
  
      await of(dbMsgs)
        .map(dbMsgs => ({ msgs: dbMsgs, spawns: [] }))
        .chain(res =>
          apis.crankMsgs(res)
            .bimap(
              logger.tap('Failed to crank messages'),
              logger.tap('Successfully cranked messages')
            )
        )
        .toPromise()
  
      let lastScheduled = scheduled[scheduled.length - 1]
  
      monitor.lastFromSortKey = lastScheduled.scheduledSortKey
  
      await updateMonitor(monitor)
  
      return {status: 'ok'}
    } catch(e) {
      console.error('Error in processMonitor:', e);
      throw e; 
    }
    
}


function shouldRun(monitor) {
  const index = runningMonitorList.findIndex(item => item.id === monitor.id);
  
  if (index !== -1) {
    return false; 
  }

  return true; 
}



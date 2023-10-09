const cuClient = {
  result: async function (cuAddress, txId) {
    console.log(`${cuAddress}/result/${txId}`)
    const resultResponse = await fetch(`${cuAddress}/result/${txId}`)
    const resultJson = await resultResponse.json()

    if (!resultJson) {
      return {
        messages: [],
        spawns: [],
        output: ''
      }
    }

    return resultJson
  },

  selectNode: async function (contractId) {
    console.log(`Selecting cu for contract ${contractId}`)
    return 'http://localhost:3005'
  }
}

export default cuClient

import { t } from '@lingui/macro'
import { CRXSUSHI, SUSHI, XSUSHI } from '../../../constants'
import { ChainId, CurrencyAmount, REACT_ADDRESS, Token } from '@reactswap/sdk'
import { tryParseAmount } from '../../../functions'
import { useActiveWeb3React, useApproveCallback, useInariContract, useZenkoContract } from '../../../hooks'
import { useTokenBalances } from '../../wallet/hooks'
import { StrategyGeneralInfo, StrategyHook, StrategyTokenDefinitions } from '../types'
import useBaseStrategy from './useBaseStrategy'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useDerivedInariState } from '../hooks'

export const general: StrategyGeneralInfo = {
  name: 'SUSHI → Cream',
  steps: ['SUSHI', 'xSUSHI', 'Cream'],
  zapMethod: 'stakeSushiToCream',
  unzapMethod: 'unstakeSushiFromCream',
  description: t`Stake SUSHI for xSUSHI and deposit into Cream in one click. xSUSHI in Cream (crXSUSHI) can be lent or used as collateral for borrowing.`,
  inputSymbol: 'SUSHI',
  outputSymbol: 'xSUSHI in Cream',
}

export const tokenDefinitions: StrategyTokenDefinitions = {
  inputToken: {
    chainId: ChainId.MAINNET,
    address: REACT_ADDRESS[ChainId.MAINNET],
    decimals: 18,
    symbol: 'SUSHI',
  },
  outputToken: {
    chainId: ChainId.MAINNET,
    address: '0x8798249c2E607446EfB7Ad49eC89dD1865Ff4272',
    decimals: 18,
    symbol: 'XSUSHI',
  },
}

const useStakeSushiToCreamStrategy = (): StrategyHook => {
  const { account } = useActiveWeb3React()
  const { zapIn, inputValue } = useDerivedInariState()
  const zenkoContract = useZenkoContract()
  const inariContract = useInariContract()
  const balances = useTokenBalances(account, [SUSHI[ChainId.MAINNET], CRXSUSHI])
  const cTokenAmountRef = useRef<CurrencyAmount<Token>>(null)
  const approveAmount = useMemo(() => (zapIn ? inputValue : cTokenAmountRef.current), [inputValue, zapIn])

  // Override approveCallback for this strategy as we need to approve CRXSUSHI on zapOut
  const approveCallback = useApproveCallback(approveAmount, inariContract?.address)
  const { execute, setBalances, ...baseStrategy } = useBaseStrategy({
    id: 'stakeSushiToCreamStrategy',
    general,
    tokenDefinitions,
  })

  const toCTokenAmount = useCallback(
    async (val: CurrencyAmount<Token>) => {
      if (!zenkoContract || !val) return null

      const bal = await zenkoContract.toCtoken(CRXSUSHI.address, val.quotient.toString())
      return CurrencyAmount.fromRawAmount(CRXSUSHI, bal.toString())
    },
    [zenkoContract]
  )

  // Run before executing transaction creation by transforming from xSUSHI value to crXSUSHI value
  // As you will be spending crXSUSHI when unzapping from this strategy
  const preExecute = useCallback(
    async (val: CurrencyAmount<Token>) => {
      if (zapIn) return execute(val)
      return execute(await toCTokenAmount(val))
    },
    [execute, toCTokenAmount, zapIn]
  )

  useEffect(() => {
    toCTokenAmount(inputValue).then((val) => (cTokenAmountRef.current = val))
  }, [inputValue, toCTokenAmount])

  useEffect(() => {
    if (!zenkoContract || !balances) return

    const main = async () => {
      if (!balances[CRXSUSHI.address]) return tryParseAmount('0', XSUSHI)
      const bal = await zenkoContract.fromCtoken(
        CRXSUSHI.address,
        balances[CRXSUSHI.address].toFixed().toBigNumber(CRXSUSHI.decimals).toString()
      )
      setBalances({
        inputTokenBalance: balances[SUSHI[ChainId.MAINNET].address],
        outputTokenBalance: CurrencyAmount.fromRawAmount(XSUSHI, bal.toString()),
      })
    }

    main()
  }, [balances, setBalances, zenkoContract])

  return useMemo(
    () => ({
      ...baseStrategy,
      approveCallback: [...approveCallback, approveAmount],
      setBalances,
      execute: preExecute,
    }),
    [approveAmount, approveCallback, baseStrategy, preExecute, setBalances]
  )
}

export default useStakeSushiToCreamStrategy

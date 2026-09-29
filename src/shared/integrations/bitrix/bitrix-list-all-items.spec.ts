import { BadGatewayException } from '@nestjs/common'
import { of, throwError } from 'rxjs'
import { BitrixService } from './bitrix.service'

function fixture() {
  const http = { get: jest.fn() }
  return { http, service: new BitrixService(http as never) }
}

describe('Bitrix listAllItems authoritative results', () => {
  it('collects every page before returning a complete list', async () => {
    const { http, service } = fixture()
    http.get.mockReturnValueOnce(of({ data: { result: { items: [{ id: 1 }] }, next: 1, total: 2 } }))
      .mockReturnValueOnce(of({ data: { result: { items: [{ id: 2 }] }, total: 2 } }))
    await expect(service.listAllItems({ entityTypeId: 1060 })).resolves.toEqual([{ id: 1 }, { id: 2 }])
    expect(http.get.mock.calls.map((call) => call[1].params.start)).toEqual([0, 1])
  })

  it('accepts an explicit empty successful result', async () => {
    const { http, service } = fixture()
    http.get.mockReturnValue(of({ data: { result: { items: [] }, total: 0 } }))
    await expect(service.listAllItems({ entityTypeId: 1060 })).resolves.toEqual([])
  })

  it.each([
    { error: 'ACCESS_DENIED', error_description: 'Access denied' },
    {},
    { result: null },
    { result: { items: null } },
    { result: { items: {} } },
    { result: { items: [] }, total: 3 },
    { result: { items: [] }, total: -1 },
    { result: { items: [] }, total: 'invalid' },
    { result: { items: [] }, next: 50 },
    { result: { items: [{ id: 1 }] }, next: 0 },
    { result: { items: [{ id: 1 }] }, next: 'invalid' },
    { result: { items: [{ id: 1 }] }, next: 1.5 },
  ])('rejects erroneous or incomplete HTTP 200 payload %j', async (data) => {
    const { http, service } = fixture()
    http.get.mockReturnValue(of({ data }))
    await expect(service.listAllItems({ entityTypeId: 1060 })).rejects.toBeInstanceOf(BadGatewayException)
  })

  it('rejects a repeated pagination cursor without looping', async () => {
    const { http, service } = fixture()
    http.get.mockReturnValue(of({ data: { result: { items: [{ id: 1 }] }, next: 50 } }))
    await expect(service.listAllItems({ entityTypeId: 1060 })).rejects.toThrow('invalid pagination cursor')
    expect(http.get).toHaveBeenCalledTimes(2)
  })

  it('rejects the full operation if a later page is unavailable', async () => {
    const { http, service } = fixture()
    http.get.mockReturnValueOnce(of({ data: { result: { items: [{ id: 1 }] }, next: 1 } }))
      .mockReturnValueOnce(throwError(() => new Error('Connection failed')))
    await expect(service.listAllItems({ entityTypeId: 1060 })).rejects.toThrow('Connection failed')
  })
})

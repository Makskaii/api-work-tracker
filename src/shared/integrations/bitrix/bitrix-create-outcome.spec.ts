import { BadGatewayException } from '@nestjs/common'
import { of, throwError } from 'rxjs'
import { BitrixItemCreateRejectedException, BitrixService } from './bitrix.service'

function makeService(postResult: ReturnType<typeof of> | ReturnType<typeof throwError>) {
  const post = jest.fn(() => postResult)
  return { service: new BitrixService({ post } as never), post }
}

const params = { entityTypeId: 1092, fields: { title: 'Project' } }

describe('BitrixService.addItem creation outcome', () => {
  it('returns a successfully created item', async () => {
    const env = makeService(of({ data: { result: { item: { id: 901 } } } }))
    await expect(env.service.addItem(params)).resolves.toEqual({ id: 901 })
  })

  it('marks a documented JSON field-validation rejection as definitive', async () => {
    const env = makeService(of({ data: { error: 'CRM_FIELD_ERROR_VALUE_NOT_VALID', error_description: 'Internal field details' } }))
    await expect(env.service.addItem(params)).rejects.toBeInstanceOf(BitrixItemCreateRejectedException)
  })

  it('marks an HTTP 400 field-validation response as definitive', async () => {
    const env = makeService(throwError(() => ({ response: { status: 400, data: { error: 'CRM_FIELD_ERROR_VALUE_NOT_VALID' } } })))
    await expect(env.service.addItem(params)).rejects.toBeInstanceOf(BitrixItemCreateRejectedException)
  })

  it('keeps a transport timeout ambiguous and does not expose request secrets', async () => {
    const env = makeService(throwError(() => ({ message: 'Timeout at webhook/secret-token', config: { headers: { Authorization: 'secret-token' } } })))
    try {
      await env.service.addItem(params)
      throw new Error('Expected a transport error')
    } catch (error) {
      expect(error).toBeInstanceOf(BadGatewayException)
      expect(error).not.toBeInstanceOf(BitrixItemCreateRejectedException)
      expect(String(error)).not.toContain('secret-token')
    }
  })

  it('keeps an internal server error ambiguous', async () => {
    const env = makeService(of({ data: { error: 'INTERNAL_SERVER_ERROR' } }))
    await expect(env.service.addItem(params)).rejects.not.toBeInstanceOf(BitrixItemCreateRejectedException)
  })
})

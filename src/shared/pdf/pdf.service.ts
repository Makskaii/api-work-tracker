import { Injectable } from '@nestjs/common'
import puppeteer from 'puppeteer'

@Injectable()
export class PdfService {
  async generatePdf(html: string, logo: string): Promise<Buffer> {
    const browser = await puppeteer.launch({
      headless: true,
      args: ['--no-sandbox', '--disable-setuid-sandbox'],
    })

    const page = await browser.newPage()

    await page.setContent(html, {
      waitUntil: 'networkidle0',
    })

    const pdf = await page.pdf({
      format: 'A4',
      printBackground: true,
      displayHeaderFooter: true,
      margin: {
        top: '90px',
        bottom: '70px',
        left: '32px',
        right: '32px',
      },
      headerTemplate: `
    <div style="
      width: 100%;
      font-size: 10px;
      padding: 0 24px;
      display: flex;
      justify-content: space-between;
      align-items: center;
    ">
      <div style="display:flex; align-items:center; gap:8px; opacity: 0.5">
                    ${
                      logo
                        ? `<img class="top-brand-logo" src="${logo}" alt="logo" height="40px"/>`
                        : ''
                    }
        <span></span>
      </div>
      <div>
        <span class="pageNumber"></span> страница из <span class="totalPages"></span>
      </div>
    </div>
  `,
      footerTemplate: `<div></div>`,
    })

    await browser.close()

    return Buffer.from(pdf)
  }
}

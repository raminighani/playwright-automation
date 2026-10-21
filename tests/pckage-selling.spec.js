// @ts-check
import { test, expect } from '@playwright/test';

const pageUrl = 'http://localhost:8282/o/1001/mobile-internet-packages';
const phoneNumber = '09045072028';

/** @param {string} value */
const toEnglishDigits = (value) => value.replace(/[۰-۹]/g, (digit) => String('۰۱۲۳۴۵۶۷۸۹'.indexOf(digit)));

/** @param {string} value */
const displayedNumber = (value) => {
    const normalized = toEnglishDigits(value).replace(/[^0-9.-]/g, '');
    const number = Number(normalized);
    if (!Number.isFinite(number)) throw new Error(`Could not parse displayed price: ${value}`);
    return number;
};

/** Match the application's `toFixed(1)` formatting for non-integer prices. @param {number} value */
const applicationPrice = (value) => Number.isInteger(value) ? value : Number(value.toFixed(1));

/** @param {import('@playwright/test').Locator} pricingDetail @param {number} expectedPrice */
const expectPricing = async (pricingDetail, expectedPrice) => {
    const expectedTax = applicationPrice(expectedPrice * 0.1);
    const expectedTotal = applicationPrice(expectedPrice + (expectedPrice * 0.1));

    await expect(pricingDetail.locator('.price span:nth-child(2)')).toHaveText(/\S/);
    await expect(pricingDetail.locator('.tax span:nth-child(2)')).toHaveText(/\S/);
    await expect(pricingDetail.locator('.pricing span:nth-child(2)')).toHaveText(/\S/);

    expect(displayedNumber(await pricingDetail.locator('.price span:nth-child(2)').innerText())).toBe(expectedPrice);
    expect(displayedNumber(await pricingDetail.locator('.tax span:nth-child(2)').innerText())).toBe(expectedTax);
    expect(displayedNumber(await pricingDetail.locator('.pricing span:nth-child(2)').innerText())).toBe(expectedTotal);
};

test('completes the package purchase flow through bank payment submission', async ({ page }) => {
    await page.goto(pageUrl);

    const packageCard = page.locator('.packages .package-card:visible')
        .filter({ has: page.locator('.grid .package-action .btn-submit.js-buy-btn') })
        .first();
    await expect(packageCard).toBeVisible();

    const packageTitle = (await packageCard.locator('.package-name-data').first().innerText()).trim();
    const packagePrice = displayedNumber(await packageCard.locator('.package-price').first().innerText());


    await packageCard.locator('.grid .package-action .btn-submit.js-buy-btn').click();

    const numberModal = page.locator('.modal.pricing-modal.number-modal:has(#payment-step-1:checked)');
    await expect(numberModal.locator('#payment-step-1')).toBeChecked();
    await expect(numberModal.locator('.modal-box')).toBeVisible();
    await expect(numberModal.locator('.package-name-modal')).toHaveText(packageTitle);
    await expectPricing(numberModal.locator('.single-numberform .pricing-detail'), packagePrice);


    const singleNumberForm = numberModal.locator('form.single-numberform');
    const numberSubmit = singleNumberForm.locator('.is-submite');
    const mobileNumber = numberModal.locator('#mobile-number');
    await expect(mobileNumber).toHaveValue('');
    await expect(numberSubmit).toBeDisabled();

    await mobileNumber.fill(phoneNumber);
    await expect(mobileNumber).toHaveValue(phoneNumber);
    await expect(numberSubmit).toBeEnabled();
    await numberSubmit.click();

    const methodModal = page.locator('.modal.pricing-modal.method-modal:has(#payment-step-2:checked)');
    await expect(methodModal.locator('#payment-step-2')).toBeChecked();
    await expect(methodModal.locator('.modal-box')).toBeVisible();
    const displayedMobile = methodModal.locator('.user-mobile').first();
    await expect.poll(async () => toEnglishDigits((await displayedMobile.innerText()).trim()))
        .toBe(phoneNumber);

    const bankMethod = methodModal.locator('#bank');
    const bankGateway = methodModal.locator('#bank-9');

    await bankMethod.check({ force: true });
    await expect(bankMethod).toBeChecked();
    await expect(bankGateway).toHaveCount(1);
    await bankGateway.check({ force: true });
    await expect(bankGateway).toBeChecked();

    await expectPricing(methodModal.locator('.pricing-detail'), packagePrice);


    const pricingTerms = methodModal.locator('#accept-pricing');

    await methodModal.locator('.checkbox-accept-pricing + label[for="accept-pricing"]').click();
    await expect(pricingTerms).toBeChecked();

    const bankSubmit = methodModal.locator('.mtn-form.bank-form .is-submite');
    await expect(bankSubmit).toBeEnabled();

    /** @type {number | undefined} */
    let paymentStatus;
    /** @type {{ message: string, status: string, product_price: number, product_name: string, product_package_type: string, transaction_id: string } | undefined} */
    let paymentBody;
    await page.route('**/wp-content/themes/mtn_personal/api/ocp.json', async (route) => {
        if (route.request().method() !== 'GET') {
            await route.continue();
            return;
        }

   
        const upstreamResponse = await route.fetch();
        const rawBody = await upstreamResponse.body();
        paymentStatus = upstreamResponse.status();
        paymentBody = JSON.parse(rawBody.toString());
        await route.fulfill({ response: upstreamResponse, body: rawBody });
    });
    await bankSubmit.click();
    await expect.poll(() => paymentStatus, { timeout: 15000 }).not.toBeUndefined();
    await page.unroute('**/wp-content/themes/mtn_personal/api/ocp.json');

    if (paymentStatus === 200) {
        if (!paymentBody) throw new Error('The successful payment response did not contain a JSON body.');
        const body = paymentBody;
        expect(body).toMatchObject({ message: 'success', status: 'OK' });
        expect(body.product_price).toBe(packagePrice);
        expect(body.product_name).toEqual(expect.any(String));
        expect(body.product_package_type).toEqual(expect.any(String));
        expect(body.transaction_id).toMatch(/^\d+$/);
    } else {
  
        await expect(page.locator('.mtn-alert.error.show:visible')).toBeVisible();
    }
});

// @ts-check
import { test, expect } from '@playwright/test';
// Package Detail test ================================================================================
const pageUrl = 'http://localhost:8282/o/1001/mobile-internet-packages';
const packagesApiUrl = 'http://localhost:8282/wp-content/themes/mtn_personal/api/packages.json';

test('renders one package card for each package returned by the API', async ({ page }) => {
  const apiResponse = await page.request.get(packagesApiUrl);
  expect(apiResponse.ok()).toBeTruthy();

  const packages = await apiResponse.json();
  expect(Array.isArray(packages)).toBeTruthy();

  await page.goto(pageUrl);
  const packageCards = page.locator('.packages .package-card');
  await expect(packageCards.first()).toBeVisible();
  await expect(packageCards).toHaveCount(packages.length);
});

test('every package card has its required content', async ({ page }) => {
  await page.goto(pageUrl);
  const packageCards = page.locator('.packages .package-card');
  await expect(packageCards.first()).toBeVisible();

  const cardCount = await packageCards.count();
  expect(cardCount).toBeGreaterThan(0);

  for (let index = 0; index < cardCount; index += 1) {
    const card = packageCards.nth(index);

    for (const selector of [
      '.package-name-data',
      '.package-storage-data',
      '.package-type-data',
      '.package-price',
    ]) {
      await expect(card.locator(selector).first()).toHaveText(/\S/);
    }

    const purchaseButtonTexts = await card.locator('.btn-text').allTextContents();
    expect(purchaseButtonTexts.length).toBeGreaterThan(0);
    expect(purchaseButtonTexts.every((text) => text.trim().length > 0)).toBeTruthy();
  }
});


// Filter test ================================================================================


const filterBodySelector = '.filters.shop-package-filters .body';
const packageCardSelector = '.packages .package-card';

/** @typedef {import('@playwright/test').Page} Page */
/** @typedef {{ id: string, price: number, specification_contents?: Array<{ key: string, value: string, desc?: { en?: string, fa?: string } }> }} PackageData */
/** @typedef {{ minimumPrice?: number, maximumPrice?: number, packageTypes?: string[], trafficOptions?: string[] }} PackageFilters */

/** @param {PackageData} packageData @param {string} key */
const getSpecification = (packageData, key) =>
  packageData.specification_contents?.find((item) => item.key === key);

/** @param {unknown} value */
const normalizeDigits = (value) =>
  String(value).replace(/[۰-۹]/g, (digit) => String('۰۱۲۳۴۵۶۷۸۹'.indexOf(digit)));

/** @param {PackageData} packageData */
const getPackageType = (packageData) => getSpecification(packageData, 'package_type')?.value || '';

/** @param {PackageData} packageData @returns {number | 'unlimited'} */
const getTraffic = (packageData) => {
  const value = getSpecification(packageData, 'traffic')?.desc?.en
    || getSpecification(packageData, 'traffic')?.desc?.fa;
  return value === 'unlimited' ? value : Number(normalizeDigits(value));
};

/** @param {PackageData} packageData @param {string} optionValue */
const matchesTrafficOption = (packageData, optionValue) => {
  const traffic = getTraffic(packageData);
  if (optionValue === 'unlimited') return traffic === 'unlimited';
  if (typeof traffic !== 'number') return false;

  const [minimum, maximum] = optionValue.split('-').map(Number);
  return traffic > minimum && traffic <= maximum;
};

/** @param {PackageData[]} packages @param {PackageFilters} [filters] */
const getExpectedPackages = (packages, filters = {}) => packages.filter((packageData) => {
  if (filters.minimumPrice !== undefined && packageData.price < filters.minimumPrice) return false;
  if (filters.maximumPrice !== undefined && packageData.price > filters.maximumPrice) return false;
  if (filters.packageTypes?.length && !filters.packageTypes.includes(getPackageType(packageData))) return false;
  if (filters.trafficOptions?.length
    && !filters.trafficOptions.some((option) => matchesTrafficOption(packageData, option))) return false;
  return true;
});

/** @param {Page} page @returns {Promise<PackageData[]>} */
const loadPackagesAndPage = async (page) => {
  const apiResponse = await page.request.get(packagesApiUrl);
  expect(apiResponse.ok()).toBeTruthy();
  /** @type {PackageData[]} */
  const packages = await apiResponse.json();
  expect(Array.isArray(packages)).toBeTruthy();

  await page.goto(pageUrl);
  await expect(page.locator(packageCardSelector).first()).toBeVisible();
  return packages;
};

/** @param {Page} page @param {PackageData[]} expectedPackages */
const expectVisiblePackages = async (page, expectedPackages) => {
  const visibleCards = page.locator(`${packageCardSelector}:visible`);
  await expect(visibleCards).toHaveCount(expectedPackages.length);

  const visibleProducts = await visibleCards.evaluateAll((cards) =>
    cards.map((card) => card.getAttribute('product')).sort());
  expect(visibleProducts).toEqual(expectedPackages.map((packageData) => packageData.id).sort());
};

/** @param {Page} page @param {PackageData[]} packages */
const resetPackageFilters = async (page, packages) => {
  await expect(page.locator('#remove-filters')).toBeVisible();
  await page.locator('#remove-filters').click();
  await expectVisiblePackages(page, packages);
};

/** @param {Page} page @param {number} minimumPrice @param {number} maximumPrice */
const setPriceRange = async (page, minimumPrice, maximumPrice) => {
  const fromPrice = page.locator(`${filterBodySelector} #from-price`);
  const toPrice = page.locator(`${filterBodySelector} #to-price`);

  await fromPrice.fill(String(minimumPrice));
  await fromPrice.press('Tab');
  await toPrice.fill(String(maximumPrice));
  await toPrice.press('Tab');
};

/** @param {Page} page @param {string} selector @returns {Promise<string[]>} */
const getFilterOptionValues = async (page, selector) =>
  page.locator(`${filterBodySelector} ${selector}`).evaluateAll((inputs) =>
    inputs.map((input) => /** @type {HTMLInputElement} */ (input).value));

/** @param {Page} page @param {string} selector @param {string} option @param {boolean} checked */
const setFilterOption = async (page, selector, option, checked) => {
  const checkbox = page.locator(`${filterBodySelector} ${selector}[value="${option}"]`);

  await checkbox.evaluate((input, isChecked) => {
    const checkboxInput = /** @type {HTMLInputElement} */ (input);
    checkboxInput.checked = isChecked;
    checkboxInput.dispatchEvent(new Event('change', { bubbles: true }));
  }, checked);
  await expect(checkbox).toHaveJSProperty('checked', checked);
};

test('filter scenarios run sequentially in one visible tab', async ({ page }) => {
  const packages = await test.step('Load the package page once', async () => loadPackagesAndPage(page));
  const prices = packages.map((packageData) => packageData.price).sort((a, b) => a - b);
  const packageTypeOptions = await getFilterOptionValues(page, '.package-type .checkbox-package-type');
  const trafficOptions = await getFilterOptionValues(page, '.traffic .checkbox-traffic');
  const packageTypes = packageTypeOptions.filter((option) =>
    packages.some((packageData) => getPackageType(packageData) === option));
  const traffic = trafficOptions.filter((option) =>
    packages.some((packageData) => matchesTrafficOption(packageData, option)));
  expect(packageTypes.length).toBeGreaterThan(1);
  expect(traffic.length).toBeGreaterThan(1);

  const reset = async () => test.step('Clear all filters', async () => {
    await resetPackageFilters(page, packages);
    console.log(`[filters] cleared; visible cards: ${packages.length}`);
  });

  await test.step('Filter by an inclusive price range', async () => {
    const splitPrice = prices[Math.floor(prices.length / 2)];
    console.log(`[filters] price range: ${prices[0]}-${splitPrice}`);
    await setPriceRange(page, prices[0], splitPrice);
    await expectVisiblePackages(page, getExpectedPackages(packages, {
      minimumPrice: prices[0], maximumPrice: splitPrice,
    }));
    console.log('[filters] price range applied and card identities verified');
  });
  await reset();

  await test.step('Filter by package type and switch selections', async () => {
    const [firstType, secondType] = packageTypes;
    console.log(`[filters] package types: ${firstType}, ${secondType}`);
    await setFilterOption(page, '.package-type .checkbox-package-type', firstType, true);
    await expectVisiblePackages(page, getExpectedPackages(packages, { packageTypes: [firstType] }));
    await setFilterOption(page, '.package-type .checkbox-package-type', firstType, false);
    await setFilterOption(page, '.package-type .checkbox-package-type', secondType, true);
    await expectVisiblePackages(page, getExpectedPackages(packages, { packageTypes: [secondType] }));
  });
  await reset();

  await test.step('Filter by traffic and combine traffic options', async () => {
    const [firstTraffic, secondTraffic] = traffic;
    console.log(`[filters] traffic options: ${firstTraffic}, ${secondTraffic}`);
    await setFilterOption(page, '.traffic .checkbox-traffic', firstTraffic, true);
    await expectVisiblePackages(page, getExpectedPackages(packages, { trafficOptions: [firstTraffic] }));
    await setFilterOption(page, '.traffic .checkbox-traffic', secondTraffic, true);
    await expectVisiblePackages(page, getExpectedPackages(packages, {
      trafficOptions: [firstTraffic, secondTraffic],
    }));
  });
  await reset();

  await test.step('Combine price, package type, and traffic filters', async () => {
    const candidate = packages.find((packageData) =>
      packageTypes.includes(getPackageType(packageData))
      && traffic.some((option) => matchesTrafficOption(packageData, option)));
    if (!candidate) throw new Error('Expected a package matching the rendered type and traffic options.');
    const packageType = getPackageType(candidate);
    const trafficOption = traffic.find((option) => matchesTrafficOption(candidate, option));
    if (!trafficOption) throw new Error('Expected a matching rendered traffic option.');
    console.log(`[filters] combined: price=${candidate.price}, type=${packageType}, traffic=${trafficOption}`);
    await setPriceRange(page, candidate.price, candidate.price);
    await setFilterOption(page, '.package-type .checkbox-package-type', packageType, true);
    await setFilterOption(page, '.traffic .checkbox-traffic', trafficOption, true);
    await expectVisiblePackages(page, getExpectedPackages(packages, {
      minimumPrice: candidate.price,
      maximumPrice: candidate.price,
      packageTypes: [packageType],
      trafficOptions: [trafficOption],
    }));
  });
  await reset();

  await test.step('Show empty results for a price gap', async () => {
    const uniquePrices = [...new Set(prices)];
    const gap = uniquePrices.slice(1).map((nextPrice, index) => ({
      minimumPrice: uniquePrices[index] + 1,
      maximumPrice: nextPrice - 1,
    })).find((range) => range.minimumPrice <= range.maximumPrice);
    test.skip(!gap, 'The rendered package data has no integer price gap.');
    if (!gap) return;
    console.log(`[filters] empty price range: ${gap.minimumPrice}-${gap.maximumPrice}`);
    await setPriceRange(page, gap.minimumPrice, gap.maximumPrice);
    await expectVisiblePackages(page, []);
  });
  await reset();

  await test.step('Verify package API errors do not affect local filtering', async () => {
    let packageApiRequests = 0;
    await page.route(packagesApiUrl, async (route) => {
      packageApiRequests += 1;
      await route.fulfill({ status: 500, contentType: 'application/json', body: '{"error":"unavailable"}' });
    });
    await setFilterOption(page, '.package-type .checkbox-package-type', packageTypes[0], true);
    await expectVisiblePackages(page, getExpectedPackages(packages, { packageTypes: [packageTypes[0]] }));
    expect(packageApiRequests).toBe(0);
    console.log('[filters] package API was unavailable, but local UI filtering remained functional');
    await page.unroute(packagesApiUrl);
  });
});

//first test ==================================================================================

"""pdfium nie jest wielowątkowy: równoległe renderowanie stron (przeglądarka prosi o kilka naraz) wywracało API."""

from concurrent.futures import ThreadPoolExecutor

from app import pdfium_safe


def test_parallel_rendering_is_serialized(minimal_pdf):
    data = minimal_pdf
    assert pdfium_safe.page_count(data) == 1
    with ThreadPoolExecutor(max_workers=8) as pool:
        imgs = list(pool.map(lambda _: pdfium_safe.page_image(data, 0, 1.6), range(32)))
    assert all(i is not None and i.width > 0 for i in imgs)
    assert pdfium_safe.page_image(data, 5, 1.6) is None
    assert len(pdfium_safe.all_page_images(data, 1.0, forms=True)) == 1

fetch('https://naiibaan-cafe.onrender.com')
    .then(res => res.json())
    .then(data => {
        const container = document.getElementById('product-list');

        data.forEach(p => {
            const div = document.createElement('div');
            div.className = 'product-card';
            div.innerHTML = `
                <h3>${p.product_name}</h3>
                <p>หมวด: ${p.category_name}</p>
                <p>ราคา: ${p.price} บาท</p>
                <p>คงเหลือ: ${p.stock}</p>
                <img src="${p.image}" width="120">
            `;
            container.appendChild(div);
        });
    })
    .catch(err => console.error(err));
